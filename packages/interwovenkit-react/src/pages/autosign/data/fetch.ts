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

/*
 * Hook to create API functions for querying grants and feegrants.
 * Note: grantee parameter is required because the settings page (ManageAutoSign)
 * allows revoking grants for any grantee, not just the embedded wallet.
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

  return { fetchFeegrant, fetchGrants }
}
