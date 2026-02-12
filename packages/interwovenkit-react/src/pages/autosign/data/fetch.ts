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
    msg: string
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
    }
    allowed_messages?: string[]
    allowedMessages?: string[]
  }
}

export interface FeegrantResponse {
  allowance: FeegrantAllowance
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
export function useAutoSignApi() {
  const initiaAddress = useInitiaAddress()
  const findChain = useFindChain()

  // Returns null if feegrant doesn't exist (API returns 500 error).
  const fetchFeegrant = async (
    chainId: string,
    grantee: string,
  ): Promise<FeegrantAllowance | null> => {
    if (!initiaAddress) return null

    const chain = findChain(chainId)
    const api = ky.create({ prefixUrl: chain.restUrl })

    try {
      const { allowance } = await api
        .get(`cosmos/feegrant/v1beta1/allowance/${initiaAddress}/${grantee}`)
        .json<FeegrantResponse>()

      return allowance
    } catch (error) {
      if (error instanceof HTTPError && [404, 500].includes(error.response.status)) {
        return null
      }
      throw error
    }
  }

  // No try-catch needed: API returns empty array when no grants exist.
  const fetchGrants = async (chainId: string, grantee: string): Promise<Grant[]> => {
    if (!initiaAddress) return []

    const chain = findChain(chainId)
    const api = ky.create({ prefixUrl: chain.restUrl })

    const { grants } = await api
      .get("cosmos/authz/v1beta1/grants", { searchParams: { granter: initiaAddress, grantee } })
      .json<GrantsResponse>()

    return grants
  }

  const fetchAllGrants = async (chainId: string) => {
    const chain = findChain(chainId)
    const address = initiaAddress

    if (!address) return []

    const endpoint = `cosmos/authz/v1beta1/grants/granter/${address}`
    const allGrants = await fetchAllPages<"grants", Grant>(
      endpoint,
      { prefixUrl: chain.restUrl },
      "grants",
    )

    return allGrants
      .filter((grant) => grant.authorization["@type"].includes("GenericAuthorization"))
      .map((grant) => ({
        grantee: grant.grantee,
        authorization: {
          msg: grant.authorization.msg,
        },
        expiration: grant.expiration,
      }))
  }

  return { fetchFeegrant, fetchGrants, fetchAllGrants }
}
