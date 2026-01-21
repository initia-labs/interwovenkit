import ky from "ky"
import { useFindChain } from "@/data/chains"
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
  }
}

export interface FeegrantResponse {
  allowance: FeegrantAllowance
}

/**
 * Creates API functions to query authorization grants and fee grants for the current initiating address.
 *
 * @returns An object containing:
 *  - `fetchFeegrant(chainId, grantee)`: Returns the fee grant allowance for the initiating address and the specified `grantee`, or `null` if none exists or on error.
 *  - `fetchGrants(chainId, grantee)`: Returns an array of grants where the initiating address is the granter and `grantee` is the grantee.
 *  - `fetchAllGrants(chainId)`: Returns an array of grants issued by the initiating address filtered to `GenericAuthorization` grants and normalized to objects with `grantee`, `authorization.msg`, and optional `expiration`; returns an empty array if the initiating address is missing or on error.
 *
 * Note: The `grantee` parameter is required for `fetchFeegrant` and `fetchGrants` because callers (e.g., the ManageAutoSign UI) may revoke grants for any grantee.
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
    } catch {
      return null
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

    try {
      const data = await ky
        .create({ prefixUrl: chain.restUrl })
        .get(`cosmos/authz/v1beta1/grants/granter/${address}`)
        .json<{
          grants: Array<{
            grantee: string
            granter: string
            authorization: { "@type": string; msg: string }
            expiration?: string
          }>
        }>()

      return data.grants
        .filter((grant) => grant.authorization["@type"].includes("GenericAuthorization"))
        .map((grant) => ({
          grantee: grant.grantee,
          authorization: {
            msg: grant.authorization.msg,
          },
          expiration: grant.expiration,
        }))
    } catch {
      return []
    }
  }

  return { fetchFeegrant, fetchGrants, fetchAllGrants }
}