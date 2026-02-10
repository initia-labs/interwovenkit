import { addMilliseconds } from "date-fns"
import { useAtom } from "jotai"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { GenericAuthorization } from "@initia/initia.proto/cosmos/authz/v1beta1/authz"
import { MsgGrant, MsgRevoke } from "@initia/initia.proto/cosmos/authz/v1beta1/tx"
import {
  AllowedMsgAllowance,
  BasicAllowance,
} from "@initia/initia.proto/cosmos/feegrant/v1beta1/feegrant"
import {
  MsgGrantAllowance,
  MsgRevokeAllowance,
} from "@initia/initia.proto/cosmos/feegrant/v1beta1/tx"
import { useFindChain, useInitiaRegistry } from "@/data/chains"
import { useConfig } from "@/data/config"
import { clearSigningClientCache } from "@/data/signer"
import { useTx } from "@/data/tx"
import { useDrawer } from "@/data/ui"
import { useInitiaAddress } from "@/public/data/hooks"
import { useAutoSignApi } from "./fetch"
import { pendingAutoSignRequestAtom } from "./store"
import { autoSignQueryKeys, useAutoSignMessageTypes, useAutoSignStatus } from "./validation"
import { storeExpectedAddress, useDeriveWallet } from "./wallet"

export function resolveDisableAutoSignGrantee(params: {
  explicitGrantee?: string
  cachedDerivedAddress?: string
  statusGrantee?: string
}): string | undefined {
  return params.explicitGrantee ?? params.cachedDerivedAddress ?? params.statusGrantee
}

export function shouldRefetchDisableAutoSignGrantee(params: {
  explicitGrantee?: string
  cachedDerivedAddress?: string
  currentGrantee?: string
}): boolean {
  return !params.currentGrantee && !params.explicitGrantee && !params.cachedDerivedAddress
}

export function shouldBroadcastDisableAutoSign(messages: unknown[]): boolean {
  return messages.length > 0
}

/* Hook to fetch existing grants and generate revoke messages for a specific grantee */
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

      const chainMsgTypes = messageTypes[chainId]
      if (!chainMsgTypes || chainMsgTypes.length === 0) {
        throw new Error(`No message types configured for chain ${chainId}`)
      }

      const derivedWallet = await deriveWallet(chainId)

      // Clear cached signing client to ensure fresh account data after wallet derivation
      clearSigningClientCache(initiaAddress, chainId)

      const revokeMessages = await fetchRevokeMessages({ chainId, grantee: derivedWallet.address })

      const expiration = durationInMs === 0 ? undefined : addMilliseconds(new Date(), durationInMs)
      const basicAllowance = {
        typeUrl: "/cosmos.feegrant.v1beta1.BasicAllowance",
        value: BasicAllowance.encode(BasicAllowance.fromPartial({ expiration })).finish(),
      }

      const feegrantMessage = {
        typeUrl: "/cosmos.feegrant.v1beta1.MsgGrantAllowance",
        value: MsgGrantAllowance.fromPartial({
          granter: initiaAddress,
          grantee: derivedWallet.address,
          allowance: {
            typeUrl: "/cosmos.feegrant.v1beta1.AllowedMsgAllowance",
            value: AllowedMsgAllowance.encode(
              AllowedMsgAllowance.fromPartial({
                allowance: basicAllowance,
                allowedMessages: ["/cosmos.authz.v1beta1.MsgExec"],
              }),
            ).finish(),
          },
        }),
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

      return { chainId, derivedWallet }
    },
    onSuccess: async ({ chainId, derivedWallet }) => {
      // Store the derived address in localStorage so we can verify on-chain grants
      // were created by this derivation method.
      if (initiaAddress) {
        storeExpectedAddress(initiaAddress, chainId, derivedWallet.address)
      }

      const queryKeys = [autoSignQueryKeys.expirations._def, autoSignQueryKeys.grants._def]
      for (const queryKey of queryKeys) {
        await queryClient.invalidateQueries({ queryKey })
      }

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
  const chains = useInitiaRegistry()
  const findChain = useFindChain()
  const { getWallet, clearWallet } = useDeriveWallet()
  const { requestTxBlock } = useTx()
  const queryClient = useQueryClient()
  const fetchRevokeMessages = useFetchRevokeMessages()
  const { data: autoSignStatus, refetch: refetchAutoSignStatus } = useAutoSignStatus()

  return useMutation({
    mutationFn: async (chainId: string = config.defaultChainId) => {
      const derivedWallet = getWallet(chainId)
      let grantee = resolveDisableAutoSignGrantee({
        explicitGrantee: options?.grantee,
        cachedDerivedAddress: derivedWallet?.address,
        statusGrantee: autoSignStatus?.granteeByChain[chainId],
      })

      if (
        shouldRefetchDisableAutoSignGrantee({
          explicitGrantee: options?.grantee,
          cachedDerivedAddress: derivedWallet?.address,
          currentGrantee: grantee,
        })
      ) {
        const refreshedStatus = await refetchAutoSignStatus()
        grantee = refreshedStatus.data?.granteeByChain[chainId]
      }

      if (!grantee) {
        throw new Error("No grantee address available")
      }

      const messages = await fetchRevokeMessages({ chainId, grantee })
      if (!shouldBroadcastDisableAutoSign(messages)) {
        return { chainId }
      }
      await requestTxBlock({ messages, chainId, internal: options?.internal })
      return { chainId }
    },
    onSuccess: async ({ chainId }) => {
      const queryKeys = [autoSignQueryKeys.expirations._def, autoSignQueryKeys.grants._def]

      for (const queryKey of queryKeys) {
        await queryClient.invalidateQueries({ queryKey })
      }

      const chain = findChain(chainId)
      const siblingChainIds = chains
        .filter((candidate) => candidate.bech32_prefix === chain.bech32_prefix)
        .map((candidate) => candidate.chain_id)
        .filter((candidateChainId) => candidateChainId !== chainId)

      let hasEnabledSibling = false

      if (siblingChainIds.length > 0) {
        const refreshedStatus = await refetchAutoSignStatus()
        hasEnabledSibling = siblingChainIds.some(
          (candidateChainId) => refreshedStatus.data?.isEnabledByChain[candidateChainId],
        )
      }

      if (!hasEnabledSibling) {
        clearWallet(chainId)
      }
    },
  })
}
