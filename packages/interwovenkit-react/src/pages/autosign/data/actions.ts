import { useSetAtom } from "jotai"
import { useQueryClient } from "@tanstack/react-query"
import { useInterwovenKitApi } from "@/data/api"
import { useTx } from "@/data/tx"
import { useInitiaAddress } from "@/public/data/hooks"
import { useAutoSignPermissions } from "./permissions"
import { autoSignQueryKeys } from "./queries"
import { autoSignExpirationAtom, useAutoSignState } from "./state"
import { getPageInfo } from "./utils"
import { useEmbeddedWalletAddress } from "./wallet"

/**
 * Hook that provides a function to register auto-sign permissions for the current website.
 * Registers the embedded wallet address as the grantee with the current site's domain and icon.
 * This allows the embedded wallet to automatically sign transactions on behalf of the user.
 */
export function useRegisterAutoSign() {
  const embeddedWalletAddress = useEmbeddedWalletAddress()
  const { createAuthenticatedInterwovenkitApi } = useInterwovenKitApi()

  const { icon } = getPageInfo()

  return async () => {
    const authenticatedInterwovenkitApi = await createAuthenticatedInterwovenkitApi()
    await authenticatedInterwovenkitApi.post("auto-sign/register", {
      json: {
        granteeAddress: embeddedWalletAddress,
        domain: window.location.origin,
        icon,
      },
    })
  }
}

/**
 * Hook that provides a function to revoke auto-sign permissions for a specific chain.
 * Removes both fee grant allowances and authorization permissions for all message types.
 * Invalidates cached queries and clears expiration data after successful revocation.
 */
export function useRevokeAutoSign() {
  const queryClient = useQueryClient()
  const initiaAddress = useInitiaAddress()
  const embeddedWalletAddress = useEmbeddedWalletAddress()
  const autoSignPermissions = useAutoSignPermissions()
  const autoSignState = useAutoSignState()
  const setAutoSignExpiration = useSetAtom(autoSignExpirationAtom)
  const { requestTxBlock } = useTx()

  return async (chainId: string) => {
    if (!autoSignPermissions[chainId]) {
      throw new Error("No auto sign permissions found for this chain")
    }

    if (!autoSignState.isEnabled[chainId]) {
      throw new Error("Auto sign is not enabled for this chain")
    }

    await requestTxBlock({
      messages: [
        {
          typeUrl: "/cosmos.feegrant.v1beta1.MsgRevokeAllowance",
          value: {
            granter: initiaAddress,
            grantee: embeddedWalletAddress,
          },
        },
        ...autoSignPermissions[chainId].map((messageType) => ({
          typeUrl: "/cosmos.authz.v1beta1.MsgRevoke",
          value: {
            granter: initiaAddress,
            grantee: embeddedWalletAddress,
            msgTypeUrl: messageType,
          },
        })),
      ],
      chainId,
    })

    // Invalidate the grants query to refresh the data
    queryClient.invalidateQueries({
      queryKey: autoSignQueryKeys.grantsByGranter._def,
    })

    setAutoSignExpiration((expirationMap) => ({ ...expirationMap, [chainId]: null }))
  }
}
