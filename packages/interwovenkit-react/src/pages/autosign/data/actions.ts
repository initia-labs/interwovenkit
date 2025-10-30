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
 * Hook that returns a function to register auto sign with a site
 */
export function useRegisterAutoSign() {
  const granteeAddress = useEmbeddedWalletAddress()
  const { createAuthenticatedInterwovenkitApi } = useInterwovenKitApi()

  const { icon } = getPageInfo()

  return async () => {
    const authenticatedInterwovenkitApi = await createAuthenticatedInterwovenkitApi()
    await authenticatedInterwovenkitApi.post("auto-sign/register", {
      json: {
        granteeAddress,
        icon,
        domain: window.location.origin,
      },
    })
  }
}

export function useRevokeAutoSign() {
  const queryClient = useQueryClient()
  const granteeAddress = useEmbeddedWalletAddress()
  const initiaAddress = useInitiaAddress()
  const permissions = useAutoSignPermissions()
  const autoSignState = useAutoSignState()
  const setAutoSignExpiration = useSetAtom(autoSignExpirationAtom)
  const { requestTxBlock } = useTx()

  return async (chainId: string) => {
    if (!permissions[chainId]) throw new Error("No auto sign permissions found for this chain")
    if (!autoSignState.isEnabled[chainId])
      throw new Error("Auto sign is not enabled for this chain")

    await requestTxBlock({
      messages: [
        {
          typeUrl: "/cosmos.feegrant.v1beta1.MsgRevokeAllowance",
          value: {
            granter: initiaAddress,
            grantee: granteeAddress,
          },
        },
        ...permissions[chainId].map((messageType) => ({
          typeUrl: "/cosmos.authz.v1beta1.MsgRevoke",
          value: {
            granter: initiaAddress,
            grantee: granteeAddress!,
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

    setAutoSignExpiration((expirationMap) => ({ ...expirationMap, [chainId]: undefined }))
  }
}
