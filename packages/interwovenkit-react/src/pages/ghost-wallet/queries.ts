import ky from "ky"
import { queryOptions } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { useInitiaAddress } from "@/public/data/hooks"
import { useDefaultChain } from "@/data/chains"
import { useConfig } from "@/data/config"
import { STALE_TIMES } from "@/data/http"
import { useEmbeddedWalletAddress } from "./hooks"

export const ghostWalletQueryKeys = createQueryKeys("interwovenkit:ghost-wallet", {
  enabled: (address: string, restUrl: string, permissions?: string[], embeddedAddress?: string) => [
    address,
    restUrl,
    permissions,
    embeddedAddress,
  ],
})

export function useIsGhostWalletEnabled() {
  const address = useInitiaAddress()
  const defaultChain = useDefaultChain()
  const config = useConfig()
  const embeddedAddress = useEmbeddedWalletAddress()
  const permissions = config.ghostWalletPermissions

  return queryOptions({
    queryKey: ghostWalletQueryKeys.enabled(
      address,
      defaultChain.restUrl,
      permissions,
      embeddedAddress,
    ).queryKey,
    queryFn: async () => {
      if (!embeddedAddress) return false

      if (!permissions?.length) return false

      const granter = address
      const grantee = embeddedAddress
      const client = ky.create({ prefixUrl: defaultChain.restUrl })

      try {
        // Check feegrant allowance
        await client.get(`cosmos/feegrant/v1beta1/allowance/${granter}/${grantee}`).json()

        // Check authz grants
        const grantsResponse = await client
          .get(`cosmos/authz/v1beta1/grants/grantee/${grantee}`)
          .json<{ grants: Array<{ granter: string; authorization: { msg: string } }> }>()

        // Check that all required permissions have grants from the correct granter
        const hasAllGrants = permissions.every((permission) =>
          grantsResponse.grants.some(
            (grant) => grant.granter === granter && grant.authorization.msg === permission,
          ),
        )

        return hasAllGrants
      } catch {
        return false
      }
    },
    enabled: !!address,
    staleTime: STALE_TIMES.MINUTE,
  })
}
