import type { EncodeObject } from "@cosmjs/proto-signing"
import type { StdFee } from "@cosmjs/stargate"
import { addMilliseconds } from "date-fns"
import { useMemo } from "react"
import { useAtom, useAtomValue } from "jotai"
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { GenericAuthorization } from "@initia/initia.proto/cosmos/authz/v1beta1/authz"
import { MsgGrant, MsgRevoke } from "@initia/initia.proto/cosmos/authz/v1beta1/tx"
import { BasicAllowance } from "@initia/initia.proto/cosmos/feegrant/v1beta1/feegrant"
import {
  MsgGrantAllowance,
  MsgRevokeAllowance,
} from "@initia/initia.proto/cosmos/feegrant/v1beta1/tx"
import { InitiaAddress } from "@initia/utils"
import { useConfig } from "@/data/config"
import { useTx } from "@/data/tx"
import { useDrawer } from "@/data/ui"
import { useInitiaAddress } from "@/public/data/hooks"
import { useAutoSignApi } from "./fetch"
import { pendingAutoSignRequestAtom } from "./store"
import { autoSignQueryKeys, useAutoSignMessageTypes } from "./validation"
import { useEmbeddedWalletAddress } from "./wallet"

/* Hook to fetch existing grants and generate revoke messages */
function useFetchRevokeMessages() {
  const granter = useInitiaAddress()
  const messageTypes = useAutoSignMessageTypes()
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

    const revokeAuthzMessages = messageTypes[chainId]
      .filter((msgType) => grants.some((grant) => grant?.authorization?.msg === msgType))
      .map((msgType) => ({
        typeUrl: "/cosmos.authz.v1beta1.MsgRevoke",
        value: MsgRevoke.fromPartial({ granter, grantee, msgTypeUrl: msgType }),
      }))

    return [...revokeFeegrantMessages, ...revokeAuthzMessages]
  }
}

export function useBuildEnableMessages() {
  const initiaAddress = useInitiaAddress()
  const embeddedWalletAddress = useEmbeddedWalletAddress()
  const pendingRequest = useAtomValue(pendingAutoSignRequestAtom)

  if (!initiaAddress || !embeddedWalletAddress) {
    throw new Error("Wallets not initialized")
  }

  if (!pendingRequest) {
    throw new Error("No pending request")
  }

  const { chainId } = pendingRequest
  const fetchRevokeMessages = useFetchRevokeMessages()
  const autoSignMessageTypes = useAutoSignMessageTypes()
  const now = useMemo(() => new Date(), [])

  const buildGrantMessages = (durationInMs?: number) => {
    const granter = initiaAddress
    const grantee = embeddedWalletAddress
    const expiration = durationInMs ? addMilliseconds(now, durationInMs) : undefined
    const messageTypes = autoSignMessageTypes[pendingRequest.chainId]

    const feegrantMessage: EncodeObject = {
      typeUrl: "/cosmos.feegrant.v1beta1.MsgGrantAllowance",
      value: MsgGrantAllowance.fromPartial({
        granter,
        grantee,
        allowance: {
          typeUrl: "/cosmos.feegrant.v1beta1.BasicAllowance",
          value: BasicAllowance.encode(BasicAllowance.fromPartial({ expiration })).finish(),
        },
      }),
    }

    const authzMessages: EncodeObject[] = messageTypes.map((msgType) => ({
      typeUrl: "/cosmos.authz.v1beta1.MsgGrant",
      value: MsgGrant.fromPartial({
        granter,
        grantee,
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

    return [feegrantMessage, ...authzMessages]
  }

  const { data: revokeMessages } = useSuspenseQuery({
    queryKey: autoSignQueryKeys.revokeMessages(chainId, initiaAddress, embeddedWalletAddress)
      .queryKey,
    queryFn: () => fetchRevokeMessages({ chainId, grantee: embeddedWalletAddress }),
  })

  return (durationInMs?: number) => [...revokeMessages, ...buildGrantMessages(durationInMs)]
}

/* Enable AutoSign by granting permissions to embedded wallet for fee delegation and message execution */
export function useEnableAutoSign() {
  const { privyContext } = useConfig()
  const initiaAddress = useInitiaAddress()
  const embeddedWalletAddress = useEmbeddedWalletAddress()
  const { submitTxBlock } = useTx()
  const queryClient = useQueryClient()
  const [pendingRequest, setPendingRequest] = useAtom(pendingAutoSignRequestAtom)
  const { closeDrawer } = useDrawer()

  if (!pendingRequest) {
    throw new Error("No pending request")
  }

  const { chainId } = pendingRequest
  const buildEnableMessages = useBuildEnableMessages()

  // Get or create embedded wallet address
  const resolveEmbeddedWalletAddress = async (): Promise<string> => {
    if (embeddedWalletAddress) return embeddedWalletAddress
    if (!privyContext) throw new Error("Privy context not available")
    const newWallet = await privyContext.createWallet({ createAdditional: false })
    return InitiaAddress(newWallet.address).bech32
  }

  return useMutation({
    mutationFn: async ({ durationInMs, fee }: { durationInMs: number; fee: StdFee }) => {
      const embeddedWalletAddress = await resolveEmbeddedWalletAddress()

      if (!initiaAddress || !embeddedWalletAddress) {
        throw new Error("Wallets not initialized")
      }

      const messages = buildEnableMessages(durationInMs)
      await submitTxBlock({ messages, chainId, fee })
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
  const embeddedWalletAddress = useEmbeddedWalletAddress()
  const grantee = options?.grantee || embeddedWalletAddress
  const { requestTxBlock } = useTx()
  const queryClient = useQueryClient()
  const fetchRevokeMessages = useFetchRevokeMessages()

  return useMutation({
    mutationFn: async (chainId: string = config.defaultChainId) => {
      if (!grantee) {
        throw new Error("Wallets not initialized")
      }

      const messages = await fetchRevokeMessages({ chainId, grantee })
      await requestTxBlock({ messages, chainId, internal: options?.internal })
    },
    onSuccess: async () => {
      const queryKeys = [autoSignQueryKeys.expirations._def, autoSignQueryKeys.allGrants._def]

      for (const queryKey of queryKeys) {
        await queryClient.invalidateQueries({ queryKey })
      }
    },
  })
}
