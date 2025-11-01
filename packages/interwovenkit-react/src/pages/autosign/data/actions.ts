import type { StdFee } from "@cosmjs/amino"
import type { EncodeObject } from "@cosmjs/proto-signing"
import { useSetAtom } from "jotai"
import { useQueryClient } from "@tanstack/react-query"
import type { TxRaw } from "@initia/initia.proto/cosmos/tx/v1beta1/tx"
import { useBackend } from "@/data/api"
import { useTx } from "@/data/tx"
import { useInitiaAddress } from "@/public/data/hooks"
import { useAutoSignPermissions } from "./permissions"
import { autoSignQueryKeys } from "./queries"
import { autoSignExpirationAtom, useAutoSignState } from "./state"
import { canAutoSignHandleRequest, getPageInfo } from "./utils"
import { useEmbeddedWalletAddress, useSignWithEmbeddedWallet } from "./wallet"

/**
 * Hook that returns a simplified tryAutoSign function
 * with all auto sign dependencies already injected.
 */
export function useTryAutoSign() {
  const autoSignState = useAutoSignState()
  const signWithEmbeddedWallet = useSignWithEmbeddedWallet()
  const autoSignPermissions = useAutoSignPermissions()

  return async (
    chainId: string,
    messages: EncodeObject[],
    fee: StdFee,
    memo: string,
  ): Promise<TxRaw | null> => {
    // Check if auto sign can handle this transaction type
    if (!canAutoSignHandleRequest({ messages, chainId }, autoSignPermissions)) {
      return null
    }

    // Check if auto sign is enabled for this chain
    const isAutoSignEnabled = await autoSignState.checkAutoSign()
    if (!isAutoSignEnabled[chainId]) {
      return null
    }

    // Sign with embedded wallet
    return await signWithEmbeddedWallet(chainId, messages, fee, memo)
  }
}

/**
 * Hook that returns a function to register auto sign with a site
 */
export function useRegisterAutoSign() {
  const granteeAddress = useEmbeddedWalletAddress()
  const { getAuthClient } = useBackend()

  const { icon } = getPageInfo()

  return async () => {
    const client = await getAuthClient()

    // Send POST request to register the domain
    await client
      .post("auto-sign/register", {
        json: {
          granteeAddress,
          icon,
          domain: window.location.origin,
        },
      })
      .catch(() => {})
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
        ...permissions[chainId].map((msg) => ({
          typeUrl: "/cosmos.authz.v1beta1.MsgRevoke",
          value: {
            granter: initiaAddress,
            grantee: granteeAddress!,
            msgTypeUrl: msg,
          },
        })),
      ],
      chainId,
    })

    // Invalidate the grants query to refresh the data
    queryClient.invalidateQueries({
      queryKey: autoSignQueryKeys.grantsByGranter._def,
    })

    setAutoSignExpiration((exp) => ({ ...exp, [chainId]: undefined }))
  }
}
