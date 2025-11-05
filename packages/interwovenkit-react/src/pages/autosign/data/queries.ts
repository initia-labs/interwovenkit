import ky from "ky"
import { useQueries, useQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { useInterwovenKitApi } from "@/data/api"
import { useInitiaRegistry } from "@/data/chains"
import { STALE_TIMES } from "@/data/http"
import { useInitiaAddress } from "@/public/data/hooks"

export const autoSignQueryKeys = createQueryKeys("interwovenkit:auto-sign", {
  grantsByGranter: (restUrl: string, granter: string) => [restUrl, granter],
  permissions: (address: string) => [address],
})

export interface AuthzGrant {
  grantee: string
  authorization: {
    "@type": string
    msg: string
  }
  expiration: string
}

export interface GrantsResponse {
  grants: AuthzGrant[]
  pagination: {
    next_key: string | null
    total: string
  }
}

export interface GrantsResponseWithChain extends GrantsResponse {
  chainId: string
}

/**
 * Hook that fetches all authz grants across all registered chains where the current user is the granter.
 * Uses parallel queries to retrieve grants from multiple chains simultaneously.
 */
export function useAllGrants() {
  const address = useInitiaAddress()
  const chains = useInitiaRegistry()

  return useQueries({
    queries: chains.map((chain) => ({
      queryKey: autoSignQueryKeys.grantsByGranter(chain.restUrl, address).queryKey,
      queryFn: async (): Promise<GrantsResponseWithChain> => {
        const client = ky.create({ prefixUrl: chain.restUrl })
        const response = await client
          .get(`cosmos/authz/v1beta1/grants/granter/${address}`)
          .json<GrantsResponse>()
        return {
          ...response,
          chainId: chain.chain_id,
        }
      },
      enabled: !!address,
      staleTime: STALE_TIMES.MINUTE,
    })),
  })
}

export interface AutoSignDomainPermission {
  granteeAddress: string
  domainAddress: string
  icon: {
    icon: string
  }
}

/**
 * Hook that retrieves auto-sign domain permissions for the current user.
 * Fetches the list of grantee addresses and their associated domains/icons
 * that have been registered for auto-sign functionality.
 */
export function useGranteeAddressDomain() {
  const address = useInitiaAddress()
  const { interwovenkitApi } = useInterwovenKitApi()

  return useQuery({
    queryKey: autoSignQueryKeys.permissions(address).queryKey,
    queryFn: async (): Promise<AutoSignDomainPermission[]> => {
      const response = await interwovenkitApi.get(`auto-sign/get-address/${address}`).json<{
        message: string
        permissions: AutoSignDomainPermission[]
      }>()

      return response.permissions
    },
    enabled: !!address,
    staleTime: STALE_TIMES.MINUTE,
  })
}
