import type { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin"
import ky, { HTTPError } from "ky"
import { useFindChain } from "@/data/chains"
import { fetchAllPages } from "@/data/pagination"
import { useInitiaAddress } from "@/public/data/hooks"

/* Shared types for authz grants and feegrant */
export interface Grant {
  granter: string
  grantee: string
  authorization: {
    "@type": string
    msg?: string
    [key: string]: unknown
  }
  expiration?: string
}

export interface GrantsResponse {
  grants: Grant[]
  pagination?: {
    next_key: string | null
    total: string
  }
}

export interface FeegrantAllowance {
  granter: string
  grantee: string
  allowance: {
    "@type": string
    expiration?: string
    allowance?: {
      "@type": string
      expiration?: string
      spend_limit?: Coin[]
      spendLimit?: Coin[]
    }
    allowed_messages?: string[]
    allowedMessages?: string[]
  }
}

export interface FeegrantResponse {
  allowance: FeegrantAllowance
}

/**
 * Grant endpoints on some registry REST hosts advertise multi-hour HTTP cache
 * lifetimes. These queries drive owner-approved revoke and reconnect flows, so
 * each explicit status read must reach the node rather than a browser cache.
 */
export function getAutoSignRestOptions(restUrl: string) {
  return { prefixUrl: restUrl, cache: "no-store" as const }
}

export function normalizeAutoSignGrants(grants: Grant[]): Grant[] {
  // Management must retain unknown authorizations. They may not be usable for
  // autosigning, but hiding them makes a partial revoke look complete.
  return grants
}

export function getFeegrantSpendLimit(
  allowance: FeegrantAllowance["allowance"],
): Coin[] | undefined {
  const basicAllowance =
    allowance["@type"] === "/cosmos.feegrant.v1beta1.AllowedMsgAllowance"
      ? allowance.allowance
      : allowance
  if (!basicAllowance) return undefined
  const allowanceWithSpendLimit = basicAllowance as {
    spendLimit?: Coin[]
    spend_limit?: Coin[]
  }
  return allowanceWithSpendLimit.spendLimit ?? allowanceWithSpendLimit.spend_limit
}

export function getFeegrantExpiration(
  allowance: FeegrantAllowance["allowance"],
): string | undefined {
  if (allowance["@type"] === "/cosmos.feegrant.v1beta1.AllowedMsgAllowance") {
    return allowance.allowance?.expiration
  }

  return allowance.expiration
}

export function getFeegrantAllowedMessages(
  allowance: FeegrantAllowance["allowance"],
): string[] | undefined {
  if (allowance["@type"] !== "/cosmos.feegrant.v1beta1.AllowedMsgAllowance") {
    return undefined
  }

  return allowance.allowedMessages ?? allowance.allowed_messages ?? []
}

/*
 * Hook to create API functions for querying grants and feegrants.
 * Note: grantee parameter is required because the settings page (ManageAutoSign)
 * allows revoking grants for any grantee, not just the derived wallet.
 */
export async function isFeegrantNotFoundResponse(response: Response): Promise<boolean> {
  if (response.status === 404) return true
  if (response.status !== 500) return false
  try {
    // Initia's gateway maps this module's missing-allowance error to gRPC
    // Internal/HTTP 500. Do not treat any other server error as absence.
    const body = await response.clone().json()
    return body?.code === 13 && body?.message === "fee-grant not found: not found"
  } catch {
    return false
  }
}

export function useAutoSignApi() {
  const initiaAddress = useInitiaAddress()
  const findChain = useFindChain()

  // A recognized not-found response is absence. Other failures are unknown and
  // must not be converted into a missing/revoked allowance.
  const fetchFeegrant = async (
    chainId: string,
    grantee: string,
  ): Promise<FeegrantAllowance | null> => {
    if (!initiaAddress) return null

    const chain = findChain(chainId)
    const api = ky.create(getAutoSignRestOptions(chain.restUrl))

    try {
      const { allowance } = await api
        .get(`cosmos/feegrant/v1beta1/allowance/${initiaAddress}/${grantee}`)
        .json<FeegrantResponse>()

      return allowance
    } catch (error) {
      if (error instanceof HTTPError && (await isFeegrantNotFoundResponse(error.response))) {
        return null
      }
      throw error
    }
  }

  // Querying the granter endpoint is paginated and avoids trusting a one-page
  // result for revocation or grant verification.
  const fetchGrants = async (chainId: string, grantee: string): Promise<Grant[]> => {
    if (!initiaAddress) return []

    const chain = findChain(chainId)
    const grants = await fetchAllPages<"grants", Grant>(
      `cosmos/authz/v1beta1/grants/granter/${initiaAddress}`,
      getAutoSignRestOptions(chain.restUrl),
      "grants",
    )
    return grants.filter((grant) => grant.grantee === grantee)
  }

  const fetchAllGrants = async (chainId: string) => {
    const chain = findChain(chainId)
    const address = initiaAddress

    if (!address) return []

    const endpoint = `cosmos/authz/v1beta1/grants/granter/${address}`
    const allGrants = await fetchAllPages<"grants", Grant>(
      endpoint,
      getAutoSignRestOptions(chain.restUrl),
      "grants",
    )
    return normalizeAutoSignGrants(allGrants)
  }

  return { fetchFeegrant, fetchGrants, fetchAllGrants }
}
