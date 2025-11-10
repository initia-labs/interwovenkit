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
import { useTx } from "@/data/tx"
import { useDrawer } from "@/data/ui"
import { useInitiaAddress } from "@/public/data/hooks"
import { pendingAutoSignRequestAtom } from "./store"
import { autoSignQueryKeys, useAutoSignMessageTypes } from "./validation"
import { useEmbeddedWalletAddress } from "./wallet"

/* Enable AutoSign by granting permissions to embedded wallet for fee delegation and message execution */
export function useEnableAutoSign() {
  const initiaAddress = useInitiaAddress()
  const messageTypes = useAutoSignMessageTypes()
  const { requestTxBlock } = useTx()
  const queryClient = useQueryClient()
  const embeddedWalletAddress = useEmbeddedWalletAddress()
  const [pendingRequest, setPendingRequest] = useAtom(pendingAutoSignRequestAtom)
  const { closeDrawer } = useDrawer()

  return useMutation({
    mutationFn: async (durationInMs: number) => {
      if (!pendingRequest) {
        throw new Error("No pending request")
      }

      const { chainId } = pendingRequest

      if (!initiaAddress || !embeddedWalletAddress) {
        throw new Error("Wallets not initialized")
      }

      const expiration = durationInMs === 0 ? undefined : addMilliseconds(new Date(), durationInMs)

      const feegrantMessage = {
        typeUrl: "/cosmos.feegrant.v1beta1.MsgGrantAllowance",
        value: MsgGrantAllowance.fromPartial({
          granter: initiaAddress,
          grantee: embeddedWalletAddress,
          allowance: {
            typeUrl: "/cosmos.feegrant.v1beta1.BasicAllowance",
            value: BasicAllowance.encode(BasicAllowance.fromPartial({ expiration })).finish(),
          },
        }),
      }

      const authzMessages = messageTypes[chainId].map((msgType) => ({
        typeUrl: "/cosmos.authz.v1beta1.MsgGrant",
        value: MsgGrant.fromPartial({
          granter: initiaAddress,
          grantee: embeddedWalletAddress,
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

      const messages = [feegrantMessage, ...authzMessages]
      await requestTxBlock({ messages, chainId, internal: true })
    },
    onSuccess: async () => {
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

/* Revoke AutoSign permissions by removing fee grants and authz delegations for embedded wallet */
export function useDisableAutoSign(options?: {
  grantee: string
  messageTypes: Record<string, string[]>
  internal: boolean
}) {
  const config = useConfig()
  const initiaAddress = useInitiaAddress()
  const embeddedWalletAddress = useEmbeddedWalletAddress()
  const grantee = options?.grantee || embeddedWalletAddress
  const messageTypes = useAutoSignMessageTypes()
  const messageTypeUrls = options?.messageTypes || messageTypes
  const { requestTxBlock } = useTx()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (chainId: string = config.defaultChainId) => {
      if (!initiaAddress || !grantee) {
        throw new Error("Wallets not initialized")
      }

      const feegrantRevokeMessage = {
        typeUrl: "/cosmos.feegrant.v1beta1.MsgRevokeAllowance",
        value: MsgRevokeAllowance.fromPartial({
          granter: initiaAddress,
          grantee: grantee,
        }),
      }

      const authzRevokeMessages = messageTypeUrls[chainId].map((msgType) => ({
        typeUrl: "/cosmos.authz.v1beta1.MsgRevoke",
        value: MsgRevoke.fromPartial({
          granter: initiaAddress,
          grantee: grantee,
          msgTypeUrl: msgType,
        }),
      }))

      const messages = [feegrantRevokeMessage, ...authzRevokeMessages]
      await requestTxBlock({ messages, chainId, internal: options?.internal })
    },
    onSuccess: async () => {
      const queryKeys = [autoSignQueryKeys.expirations._def, autoSignQueryKeys.grants._def]

      for (const queryKey of queryKeys) {
        await queryClient.invalidateQueries({ queryKey })
      }
    },
  })
}
