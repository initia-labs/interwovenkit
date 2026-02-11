import { addMilliseconds } from "date-fns"
import { useAtom } from "jotai"
import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query"
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
import { type FeegrantAllowance, getFeegrantAllowedMessages, useAutoSignApi } from "./fetch"
import { pendingAutoSignRequestAtom } from "./store"
import { autoSignQueryKeys, useAutoSignMessageTypes, useAutoSignStatus } from "./validation"
import { getExpectedAddress, storeExpectedAddress, useDeriveWallet } from "./wallet"

type RevokeMessage = {
  typeUrl: string
  value: MsgRevoke | MsgRevokeAllowance
}

const AUTHZ_EXEC_MESSAGE_TYPE = "/cosmos.authz.v1beta1.MsgExec"

export function resolveDisableAutoSignGranteeCandidates(params: {
  explicitGrantee?: string
  cachedDerivedAddress?: string
  statusGrantee?: string
  refetchedStatusGrantee?: string
}): string[] {
  if (params.explicitGrantee) {
    return [params.explicitGrantee]
  }

  const candidates = [
    params.cachedDerivedAddress,
    params.statusGrantee,
    params.refetchedStatusGrantee,
  ].filter((value): value is string => !!value)

  return [...new Set(candidates)]
}

export function resolveEnableAutoSignGranteeCandidates(params: {
  currentGrantee: string
  expectedGrantee?: string | null
  existingGrants: Array<{ grantee: string; authorization: { msg: string } }>
  existingFeegrants: FeegrantAllowance[]
  allowedMessageTypes: string[]
}): string[] {
  const {
    currentGrantee,
    expectedGrantee,
    existingGrants,
    existingFeegrants,
    allowedMessageTypes,
  } = params
  const baselineCandidates = [currentGrantee, expectedGrantee].filter(
    (value): value is string => !!value,
  )
  const knownCandidates = new Set(baselineCandidates)
  const allowedSet = new Set(allowedMessageTypes)
  const grantedTypesByGrantee = new Map<string, Set<string>>()

  for (const grant of existingGrants) {
    if (!allowedSet.has(grant.authorization.msg)) {
      continue
    }
    const grantedTypes = grantedTypesByGrantee.get(grant.grantee) ?? new Set<string>()
    grantedTypes.add(grant.authorization.msg)
    grantedTypesByGrantee.set(grant.grantee, grantedTypes)
  }

  for (const [grantee, grantedTypes] of grantedTypesByGrantee) {
    const hasFullConfiguredCoverage = allowedMessageTypes.every((msgType) =>
      grantedTypes.has(msgType),
    )
    if (hasFullConfiguredCoverage) {
      knownCandidates.add(grantee)
    }
  }

  const eligibleFeegrantGrantees = resolveAutoSignFeegrantGranteeCandidates({
    feegrants: existingFeegrants,
    knownAutoSignGrantees: [...knownCandidates],
  })
  const eligibleFeegrantSet = new Set(eligibleFeegrantGrantees)
  const granteesToRevoke = new Set<string>(baselineCandidates)

  for (const grantee of knownCandidates) {
    const grantedTypes = grantedTypesByGrantee.get(grantee)
    const hasFullConfiguredCoverage =
      !!grantedTypes && allowedMessageTypes.every((msgType) => grantedTypes.has(msgType))
    if (hasFullConfiguredCoverage && eligibleFeegrantSet.has(grantee)) {
      granteesToRevoke.add(grantee)
    }
  }

  return [...granteesToRevoke]
}

export function resolveAutoSignFeegrantGranteeCandidates(params: {
  feegrants: FeegrantAllowance[]
  knownAutoSignGrantees: string[]
}): string[] {
  const { feegrants, knownAutoSignGrantees } = params
  const knownGrantees = new Set(knownAutoSignGrantees)
  const candidates = feegrants
    .filter((feegrant) => knownGrantees.has(feegrant.grantee))
    .filter((feegrant) => {
      const allowedMessages = getFeegrantAllowedMessages(feegrant.allowance)
      // BasicAllowance (undefined allowed messages) is treated as legacy-compatible and
      // revoked only for known autosign grantees.
      return !allowedMessages || allowedMessages.includes(AUTHZ_EXEC_MESSAGE_TYPE)
    })
    .map((feegrant) => feegrant.grantee)

  return [...new Set(candidates)]
}

export function shouldClearDerivedWalletAfterDisable(params: {
  isEnabledOnTargetChain?: boolean
  hasEnabledSibling: boolean
}): boolean {
  const { isEnabledOnTargetChain, hasEnabledSibling } = params
  return isEnabledOnTargetChain === false && !hasEnabledSibling
}

async function invalidateAutoSignQueries(queryClient: QueryClient) {
  const queryKeys = [autoSignQueryKeys.expirations._def, autoSignQueryKeys.grants._def]
  for (const queryKey of queryKeys) {
    await queryClient.invalidateQueries({ queryKey })
  }
}

/* Hook to fetch existing grants and generate revoke messages for a specific grantee */
function useFetchRevokeMessages() {
  const granter = useInitiaAddress()
  const messageTypes = useAutoSignMessageTypes()
  const { fetchFeegrant, fetchGrants } = useAutoSignApi()

  return async (params: { chainId: string; grantee: string }): Promise<RevokeMessage[]> => {
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

    const configuredTypes = new Set(messageTypes[chainId] ?? [])
    const autoSignGrantTypes = [...new Set(grants.map((grant) => grant?.authorization?.msg))]
      .filter((msgType): msgType is string => !!msgType)
      .filter((msgType) => configuredTypes.has(msgType))

    const revokeAuthzMessages = autoSignGrantTypes.map((msgType) => ({
      typeUrl: "/cosmos.authz.v1beta1.MsgRevoke",
      value: MsgRevoke.fromPartial({ granter, grantee, msgTypeUrl: msgType }),
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
  const { fetchAllFeegrants, fetchAllGrants } = useAutoSignApi()
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

      const [existingGrants, existingFeegrants] = await Promise.all([
        fetchAllGrants(chainId),
        fetchAllFeegrants(chainId),
      ])
      const expectedGrantee = getExpectedAddress(initiaAddress, chainId)
      const granteesToRevoke = resolveEnableAutoSignGranteeCandidates({
        currentGrantee: derivedWallet.address,
        expectedGrantee,
        existingGrants,
        existingFeegrants,
        allowedMessageTypes: chainMsgTypes,
      })
      const revokeMessagesByGrantee = await Promise.all(
        granteesToRevoke.map((grantee) => fetchRevokeMessages({ chainId, grantee })),
      )
      const revokeMessages = revokeMessagesByGrantee.flat()

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
                allowedMessages: [AUTHZ_EXEC_MESSAGE_TYPE],
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

      await invalidateAutoSignQueries(queryClient)

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
      const statusGrantee = autoSignStatus?.granteeByChain[chainId]
      let refetchedStatusGrantee: string | undefined

      if (!options?.grantee) {
        const refreshedStatus = await refetchAutoSignStatus()
        refetchedStatusGrantee = refreshedStatus.data?.granteeByChain[chainId]
      }

      const granteeCandidates = resolveDisableAutoSignGranteeCandidates({
        explicitGrantee: options?.grantee,
        cachedDerivedAddress: derivedWallet?.address,
        statusGrantee,
        refetchedStatusGrantee,
      })

      if (granteeCandidates.length === 0) {
        throw new Error("No grantee address available")
      }

      const messagesByGrantee = await Promise.all(
        granteeCandidates.map((grantee) => fetchRevokeMessages({ chainId, grantee })),
      )
      const messages = messagesByGrantee.flat()

      if (messages.length === 0) {
        return { chainId, didBroadcast: false }
      }
      await requestTxBlock({ messages, chainId, internal: options?.internal })
      return { chainId, didBroadcast: true }
    },
    onSuccess: async ({ chainId }) => {
      await invalidateAutoSignQueries(queryClient)

      const chain = findChain(chainId)
      const siblingChainIds = chains
        .filter((candidate) => candidate.bech32_prefix === chain.bech32_prefix)
        .map((candidate) => candidate.chain_id)
        .filter((candidateChainId) => candidateChainId !== chainId)

      let latestStatus = autoSignStatus
      const refreshedStatus = await refetchAutoSignStatus()
      if (refreshedStatus.data) {
        latestStatus = refreshedStatus.data
      }

      let hasEnabledSibling = false
      if (siblingChainIds.length > 0 && latestStatus) {
        hasEnabledSibling = siblingChainIds.some(
          (candidateChainId) => latestStatus?.isEnabledByChain[candidateChainId],
        )
      }

      const isEnabledOnTargetChain = latestStatus?.isEnabledByChain[chainId]
      const shouldClearWallet = shouldClearDerivedWalletAfterDisable({
        isEnabledOnTargetChain,
        hasEnabledSibling,
      })

      if (shouldClearWallet) {
        clearWallet(chainId)
      }
    },
  })
}
