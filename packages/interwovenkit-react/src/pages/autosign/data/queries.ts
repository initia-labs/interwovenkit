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

/**
 * Checks if auto-sign is enabled for a specific grantee by verifying both feegrant and authz grants.
 * Validates that all required permissions are granted and determines the earliest expiration time.
 */
export async function checkAutoSignExpiration(
  granter: string,
  grantee: string,
  permissions: string[],
  restUrl: string,
): Promise<number | null> {
  try {
    if (!grantee) return null
    if (!permissions?.length) return null

    const client = ky.create({ prefixUrl: restUrl })

    // Check feegrant allowance
    const feegrantResponse = await client
      .get(`cosmos/feegrant/v1beta1/allowance/${granter}/${grantee}`)
      .json<{ allowance: { allowance?: { expiration?: string } } }>()

    // Check authz grants
    const grantsResponse = await client.get(`cosmos/authz/v1beta1/grants/grantee/${grantee}`).json<{
      grants: Array<{ granter: string; authorization: { msg: string }; expiration?: string }>
    }>()

    // Check that all required permissions have grants from the correct granter
    const relevantGrants = grantsResponse.grants.filter(
      (grant) => grant.granter === granter && permissions.includes(grant.authorization.msg),
    )

    const hasAllGrants = permissions.every((permission) =>
      relevantGrants.some((grant) => grant.authorization.msg === permission),
    )

    if (!hasAllGrants) {
      return null
    }

    const expirations = [
      ...relevantGrants.map((grant) => grant.expiration).filter(Boolean),
      feegrantResponse.allowance?.allowance?.expiration,
    ]
      .filter((expiration): expiration is string => !!expiration)
      .map((expirationString) => new Date(expirationString).getTime())

    const earliestExpiration = expirations.length > 0 ? Math.min(...expirations) : null

    return earliestExpiration
  } catch {
    return null
  }
}

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
