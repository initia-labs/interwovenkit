import { addMilliseconds } from "date-fns"
import { useAtom } from "jotai"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { GenericAuthorization } from "@initia/initia.proto/cosmos/authz/v1beta1/authz"
import { MsgGrant, MsgRevoke } from "@initia/initia.proto/cosmos/authz/v1beta1/tx"
import { BasicAllowance } from "@initia/initia.proto/cosmos/feegrant/v1beta1/feegrant"
import {
  MsgGrantAllowance,
  MsgRevokeAllowance,
} from "@initia/initia.proto/cosmos/feegrant/v1beta1/tx"
import { useConfig } from "@/data/config"
import { clearSigningClientCache } from "@/data/signer"
import { useTx } from "@/data/tx"
import { useDrawer } from "@/data/ui"
import { useInitiaAddress } from "@/public/data/hooks"
import { useAutoSignApi } from "./fetch"
import { pendingAutoSignRequestAtom } from "./store"
import { autoSignQueryKeys, useAutoSignMessageTypes, useAutoSignStatus } from "./validation"
import { storeExpectedAddress, useDeriveWallet } from "./wallet"

/* Hook to fetch existing grants and generate revoke messages */
function useFetchRevokeMessages() {
  const granter = useInitiaAddress()
  const { fetchFeegrant, fetchGrants } = useAutoSignApi()

  return async (params: { chainId: string; grantee: string }) => {
    const { chainId, grantee } = params

    if (!granter) {
      throw new Error("Granter wallet not initialized")
    }

    const feegrant = await fetchFeegrant(chainId, grantee)
    const grants = await fetchGrants(chainId, grantee)

    const revokeFeegrantMessages = feegrant
      ? [
          {
            typeUrl: "/cosmos.feegrant.v1beta1.MsgRevokeAllowance",
            value: MsgRevokeAllowance.fromPartial({ granter, grantee }),
          },
        ]
      : []

    const revokeAuthzMessages = grants
      .filter((grant) => grant?.authorization?.msg)
      .map((grant) => ({
        typeUrl: "/cosmos.authz.v1beta1.MsgRevoke",
        value: MsgRevoke.fromPartial({ granter, grantee, msgTypeUrl: grant.authorization.msg }),
      }))

    return [...revokeFeegrantMessages, ...revokeAuthzMessages]
  }
}

/* Enable AutoSign by deriving wallet from signature and granting permissions */
export function useEnableAutoSign() {
  const initiaAddress = useInitiaAddress()
  const messageTypes = useAutoSignMessageTypes()
  const { requestTxBlock } = useTx()
  const queryClient = useQueryClient()
  const [pendingRequest, setPendingRequest] = useAtom(pendingAutoSignRequestAtom)
  const { closeDrawer } = useDrawer()
  const fetchRevokeMessages = useFetchRevokeMessages()
  const { deriveWallet } = useDeriveWallet()

  return useMutation({
    mutationFn: async (durationInMs: number) => {
      if (!pendingRequest) {
        throw new Error("No pending request")
      }

      const { chainId } = pendingRequest

      if (!initiaAddress) {
        throw new Error("Wallet not connected")
      }

      const derivedWallet = await deriveWallet(chainId)

      // Clear cached signing client to ensure fresh account data after wallet derivation
      clearSigningClientCache(initiaAddress, chainId)

      const revokeMessages = await fetchRevokeMessages({ chainId, grantee: derivedWallet.address })

      const expiration = durationInMs === 0 ? undefined : addMilliseconds(new Date(), durationInMs)

      const feegrantMessage = {
        typeUrl: "/cosmos.feegrant.v1beta1.MsgGrantAllowance",
        value: MsgGrantAllowance.fromPartial({
          granter: initiaAddress,
          grantee: derivedWallet.address,
          allowance: {
            typeUrl: "/cosmos.feegrant.v1beta1.BasicAllowance",
            value: BasicAllowance.encode(BasicAllowance.fromPartial({ expiration })).finish(),
          },
        }),
      }

      const chainMsgTypes = messageTypes[chainId]
      if (!chainMsgTypes || chainMsgTypes.length === 0) {
        throw new Error(`No message types configured for chain ${chainId}`)
      }

      const authzMessages = chainMsgTypes.map((msgType) => ({
        typeUrl: "/cosmos.authz.v1beta1.MsgGrant",
        value: MsgGrant.fromPartial({
          granter: initiaAddress,
          grantee: derivedWallet.address,
          grant: {
            authorization: {
              typeUrl: "/cosmos.authz.v1beta1.GenericAuthorization",
              value: GenericAuthorization.encode(
                GenericAuthorization.fromPartial({ msg: msgType }),
              ).finish(),
            },
            expiration,
          },
        }),
      }))

      const messages = [...revokeMessages, feegrantMessage, ...authzMessages]
      await requestTxBlock({ messages, chainId, internal: true })

      return derivedWallet
    },
    onSuccess: async (derivedWallet) => {
      // Store the derived address in localStorage so we can verify on-chain grants
      // were created by this derivation method.
      if (pendingRequest && initiaAddress) {
        const { chainId } = pendingRequest
        storeExpectedAddress(window.location.origin, chainId, initiaAddress, derivedWallet.address)
      }

      await queryClient.invalidateQueries({
        queryKey: autoSignQueryKeys.expirations._def,
      })

      pendingRequest?.resolve()
    },
    onError: (error: Error) => {
      pendingRequest?.reject(error)
    },
    onSettled: () => {
      setPendingRequest(null)
      closeDrawer()
    },
  })
}

/* Revoke AutoSign permissions and clear derived wallet from memory */
export function useDisableAutoSign(options?: { grantee: string; internal: boolean }) {
  const config = useConfig()
  const { getWallet, clearWallet } = useDeriveWallet()
  const { requestTxBlock } = useTx()
  const queryClient = useQueryClient()
  const fetchRevokeMessages = useFetchRevokeMessages()
  const { data: autoSignStatus } = useAutoSignStatus()

  return useMutation({
    mutationFn: async (chainId: string = config.defaultChainId) => {
      const derivedWallet = getWallet(chainId)
      const grantee =
        options?.grantee || derivedWallet?.address || autoSignStatus?.granteeByChain[chainId]

      if (!grantee) {
        throw new Error("No grantee address available")
      }

      const messages = await fetchRevokeMessages({ chainId, grantee })
      await requestTxBlock({ messages, chainId, internal: options?.internal })
    },
    onSuccess: async (_, chainId = config.defaultChainId) => {
      const queryKeys = [autoSignQueryKeys.expirations._def, autoSignQueryKeys.grants._def]

      for (const queryKey of queryKeys) {
        await queryClient.invalidateQueries({ queryKey })
      }

      clearWallet(chainId)
    },
  })
}
