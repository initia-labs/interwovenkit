import ky from "ky"
import { useQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { useDefaultChain } from "@/data/chains"
import { STALE_TIMES } from "@/data/http"
import { useInitiaAddress } from "@/public/data/hooks"

export const ghostWalletQueryKeys = createQueryKeys("interwovenkit:ghost-wallet", {
  grantsByGranter: (restUrl: string, granter: string) => [restUrl, granter],
})

export async function checkGhostWalletEnabled(
  granter: string,
  grantee: string,
  permissions: string[],
  restUrl: string,
): Promise<{ enabled: boolean; expiresAt?: number }> {
  if (!grantee) return { enabled: false }
  if (!permissions?.length) return { enabled: false }

  const client = ky.create({ prefixUrl: restUrl })

  try {
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
      return { enabled: false }
    }

    // Find the earliest expiration from all grants and feegrant
    const expirations = [
      ...relevantGrants.map((grant) => grant.expiration).filter(Boolean),
      feegrantResponse.allowance?.allowance?.expiration,
    ]
      .filter(Boolean)
      .map((exp) => new Date(exp!).getTime())

    const earliestExpiration = expirations.length > 0 ? Math.min(...expirations) : undefined

    return {
      enabled: true,
      expiresAt: earliestExpiration,
    }
  } catch {
    return { enabled: false }
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

export function useAllGrants() {
  const address = useInitiaAddress()
  const defaultChain = useDefaultChain()

  return useQuery({
    queryKey: ghostWalletQueryKeys.grantsByGranter(defaultChain.restUrl, address).queryKey,
    queryFn: async (): Promise<GrantsResponse> => {
      const client = ky.create({ prefixUrl: defaultChain.restUrl })
      return client.get(`cosmos/authz/v1beta1/grants/granter/${address}`).json<GrantsResponse>()
    },
    enabled: !!address,
    staleTime: STALE_TIMES.MINUTE,
  })
}
