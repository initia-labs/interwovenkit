import { addMilliseconds } from "date-fns"
import { useAtom, useStore } from "jotai"
import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query"
import { MsgRevoke } from "@initia/initia.proto/cosmos/authz/v1beta1/tx"
import { MsgRevokeAllowance } from "@initia/initia.proto/cosmos/feegrant/v1beta1/tx"
import { useConfig } from "@/data/config"
import { isConfirmedTxFailure, isTxNotBroadcast } from "@/data/errors"
import { clearSigningClientCache } from "@/data/signer"
import { useTx } from "@/data/tx"
import { useDrawer } from "@/data/ui"
import { useInitiaAddress } from "@/public/data/hooks"
import { useAutoSignApi } from "./fetch"
import { buildAutoSignGrantMessages } from "./grant"
import { withAutoSignOperation } from "./lifecycle"
import { getRevokeMessageType } from "./policy"
import { AutoSignCancelledError, AutoSignPendingResolutionError } from "./storage"
import { activeWalletOwnerAtom, pendingAutoSignRequestAtom, walletGenerationAtom } from "./store"
import { autoSignQueryKeys, useAutoSignMessageTypes, useAutoSignStatus } from "./validation"
import {
  clearExpectedAddress,
  getExpectedAddress,
  storeExpectedAddress,
  useDeriveWallet,
} from "./wallet"

type RevokeMessage = {
  typeUrl: string
  value: MsgRevoke | MsgRevokeAllowance
}

export type EnableAutoSignInput =
  | number
  | {
      durationInMs: number
      stayConnected?: boolean
    }

function resolveEnableAutoSignInput(input: EnableAutoSignInput) {
  return typeof input === "number" ? { durationInMs: input } : input
}

export interface RenewAutoSignInput {
  chainId: string
  durationInMs: number
  stayConnected?: boolean
}

export const AUTO_SIGN_GRANT_REVALIDATION_DELAY_MS = 2_000

export class AutoSignConfirmedLocalPendingError extends Error {
  constructor(
    readonly transactionHash: string,
    readonly cause: unknown,
  ) {
    super(
      `The autosign transaction ${transactionHash} was confirmed, but the browser could not finish updating the local signer${cause instanceof Error ? `. ${cause.message}` : ""}`,
    )
    this.name = "AutoSignConfirmedLocalPendingError"
  }
}

const scheduledGrantRevalidations = new WeakMap<QueryClient, ReturnType<typeof setTimeout>>()

/**
 * Nodes can accept a grant or revoke before their REST indexer exposes it.
 * Recheck once after the immediate invalidation, coalescing mutations that
 * finish within the indexing window.
 */
export function scheduleAutoSignGrantRevalidation(queryClient: QueryClient) {
  const previous = scheduledGrantRevalidations.get(queryClient)
  if (previous) clearTimeout(previous)

  const timer = setTimeout(() => {
    scheduledGrantRevalidations.delete(queryClient)
    void queryClient
      .invalidateQueries({ queryKey: autoSignQueryKeys.expirations._def })
      .catch(() => undefined)
    void queryClient
      .invalidateQueries({ queryKey: autoSignQueryKeys.grants._def })
      .catch(() => undefined)
  }, AUTO_SIGN_GRANT_REVALIDATION_DELAY_MS)
  scheduledGrantRevalidations.set(queryClient, timer)
}

export function resolveDisableAutoSignGranteeCandidates(params: {
  explicitGrantee?: string
  cachedDerivedAddress?: string
  activeIdentityAddress?: string
  localIdentityAddresses?: Iterable<string>
  statusGrantee?: string
  refetchedStatusGrantee?: string
}): string[] {
  if (params.explicitGrantee) {
    return [params.explicitGrantee]
  }

  const candidates = [
    params.cachedDerivedAddress,
    params.activeIdentityAddress,
    ...(params.localIdentityAddresses ?? []),
    params.statusGrantee,
    params.refetchedStatusGrantee,
  ].filter((value): value is string => !!value)

  return [...new Set(candidates)]
}

export function resolveEnableAutoSignGranteeCandidates(params: {
  currentGrantee: string
  expectedGrantee?: string | null
  activeGrantee?: string
  knownGrantees?: Iterable<string>
}): string[] {
  const candidates = [
    params.currentGrantee,
    params.expectedGrantee,
    params.activeGrantee,
    ...(params.knownGrantees ?? []),
  ].filter((value): value is string => !!value)
  return [...new Set(candidates)]
}

/** A replacement random key remains pending until its owner transaction succeeds. */
export function shouldUpdateStayConnectedOnEnable(params: {
  hasActiveIdentity: boolean
  createRandomCandidate: boolean
  stayConnected: boolean | undefined
}): boolean {
  return !params.createRandomCandidate && params.stayConnected !== undefined
}

/** Legacy callers may omit the checkbox value; honor the saved preference. */
export function resolveEnableStayConnected(
  requestedStayConnected: boolean | undefined,
  storedStayConnected: boolean,
): boolean {
  return requestedStayConnected ?? storedStayConnected
}

export function shouldCreateRandomAutoSignCandidate(params: {
  expectedGrantee: string | null | undefined
  hasActiveIdentity: boolean
  stayConnected: boolean
  autoSignStorage: "browser" | "memory" | undefined
}): boolean {
  return (
    !params.expectedGrantee &&
    !params.hasActiveIdentity &&
    params.stayConnected &&
    params.autoSignStorage !== "memory"
  )
}

export function shouldCreateRenewRandomCandidate(params: {
  activeIdentityProvenance: "legacy-derived" | "random" | undefined
  restoredWallet: boolean
  stayConnected: boolean | undefined
  autoSignStorage: "browser" | "memory" | undefined
}): boolean {
  return (
    params.activeIdentityProvenance === "random" &&
    !params.restoredWallet &&
    params.stayConnected === true &&
    params.autoSignStorage !== "memory"
  )
}

export function shouldDiscardPendingAutoSignCandidate(params: {
  requestStarted: boolean
  confirmedTxFailure: boolean
  notBroadcast: boolean
}): boolean {
  return !params.requestStarted || params.confirmedTxFailure || params.notBroadcast
}

/** A legacy mirror verifies only reproducible signature-derived signers. */
export function getLegacyExpectedAddressAction(
  provenance: "legacy-derived" | "random" | undefined,
): "store" | "clear" | undefined {
  if (provenance === "legacy-derived") return "store"
  if (provenance === "random") return "clear"
  return undefined
}

function isOwnerFenceCurrent(
  store: ReturnType<typeof useStore>,
  owner: string,
  generation: number,
) {
  return (
    store.get(activeWalletOwnerAtom) === owner && store.get(walletGenerationAtom) === generation
  )
}

export function collectRevokeAuthzMessageTypes(
  grants: Array<{ authorization: { "@type"?: string; msg?: string } }>,
): string[] {
  return [
    ...new Set(
      grants.flatMap(
        (grant) =>
          getRevokeMessageType(grant) ??
          (!grant.authorization["@type"] && grant.authorization.msg
            ? [grant.authorization.msg]
            : []),
      ),
    ),
  ]
}

function invalidateAutoSignQueriesWithoutMasking(queryClient: QueryClient) {
  const queryKeys = [autoSignQueryKeys.expirations._def, autoSignQueryKeys.grants._def]
  for (const queryKey of queryKeys) {
    try {
      void queryClient.invalidateQueries({ queryKey, refetchType: "none" }).catch(() => undefined)
    } catch {
      // Cache refresh failures must never replace a confirmed or ambiguous transaction outcome.
    }
  }
  scheduleAutoSignGrantRevalidation(queryClient)
}

async function refreshAutoSignQueriesWithoutMasking(queryClient: QueryClient) {
  const queryKeys = [autoSignQueryKeys.expirations._def, autoSignQueryKeys.grants._def]
  await Promise.allSettled(
    queryKeys.map((queryKey) =>
      Promise.resolve().then(() => queryClient.invalidateQueries({ queryKey })),
    ),
  )
  scheduleAutoSignGrantRevalidation(queryClient)
}

async function assertSessionDowngradeHasNoPendingIdentities(
  stayConnected: boolean | undefined,
  getOwnerPendingIdentities: () => Promise<Array<{ chainId: string }>>,
) {
  if (stayConnected !== false) return
  const pending = await getOwnerPendingIdentities()
  if (pending.length) {
    throw new AutoSignPendingResolutionError(pending.map(({ chainId }) => chainId))
  }
}

/* Hook to fetch existing grants and generate revoke messages for a specific grantee */
function useFetchRevokeMessages() {
  const granter = useInitiaAddress()
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

    const autoSignGrantTypes = collectRevokeAuthzMessageTypes(grants)

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
  const config = useConfig()
  const messageTypes = useAutoSignMessageTypes()
  const { requestTxBlock } = useTx()
  const queryClient = useQueryClient()
  const store = useStore()
  const [pendingRequest, setPendingRequest] = useAtom(pendingAutoSignRequestAtom)
  const { closeDrawer } = useDrawer()
  const fetchRevokeMessages = useFetchRevokeMessages()
  const {
    activateWallet,
    createWallet,
    discardPendingIdentity,
    deriveWallet,
    getOwnerPendingIdentities,
    getStayConnected,
    getWalletProvenance,
    getWalletRevision,
    getWalletIdentities,
    restoreWallet,
    setStayConnected,
    updateWalletObservation,
  } = useDeriveWallet()

  return useMutation({
    mutationFn: async (input: EnableAutoSignInput) => {
      const { durationInMs, stayConnected } = resolveEnableAutoSignInput(input)
      if (!pendingRequest) {
        throw new Error("No pending request")
      }

      const { chainId } = pendingRequest

      if (!initiaAddress) {
        throw new Error("Wallet not connected")
      }
      if (pendingRequest.owner !== initiaAddress) {
        throw new AutoSignCancelledError()
      }
      const ownerGeneration = store.get(walletGenerationAtom)
      let pendingCandidateKeyId: string | undefined
      let requestStarted = false
      let chainConfirmed = false
      let transactionHash: string | undefined

      try {
        return await withAutoSignOperation(initiaAddress, async () => {
          if (!isOwnerFenceCurrent(store, initiaAddress, ownerGeneration)) {
            throw new AutoSignCancelledError()
          }
          const chainMsgTypes = messageTypes[chainId]
          if (!chainMsgTypes || chainMsgTypes.length === 0) {
            throw new Error(`No message types configured for chain ${chainId}`)
          }

          const expectedGrantee = getExpectedAddress(initiaAddress, chainId)
          // Derivation can replace the identity slot. Keep this pre-operation
          // inventory so the owner transaction revokes every prior signer.
          const identitiesBeforeDerivation = await getWalletIdentities(chainId)
          const activeIdentity = identitiesBeforeDerivation.find(
            (identity) => identity.state === "active",
          )
          const effectiveStayConnected = resolveEnableStayConnected(
            stayConnected,
            await getStayConnected(chainId),
          )
          if (!isOwnerFenceCurrent(store, initiaAddress, ownerGeneration)) {
            throw new AutoSignCancelledError()
          }
          let createRandomCandidate = shouldCreateRandomAutoSignCandidate({
            expectedGrantee,
            hasActiveIdentity: !!activeIdentity,
            stayConnected: effectiveStayConnected,
            autoSignStorage: config.autoSignStorage,
          })
          let derivedWallet
          if (createRandomCandidate) {
            derivedWallet = await createWallet(chainId, {
              stayConnected: effectiveStayConnected,
              random: true,
            })
            pendingCandidateKeyId = getWalletRevision(chainId)?.keyId
          } else if (activeIdentity) {
            const restored = await restoreWallet(chainId)
            if (restored) {
              derivedWallet = restored
            } else if (
              activeIdentity.provenance === "random" &&
              effectiveStayConnected &&
              config.autoSignStorage !== "memory"
            ) {
              // Enable again is an explicit owner action. Replace an unavailable
              // random signer with a pending durable key and revoke the old
              // public identity in the same owner-signed transaction.
              createRandomCandidate = true
              derivedWallet = await createWallet(chainId, {
                stayConnected: effectiveStayConnected,
                random: true,
              })
              pendingCandidateKeyId = getWalletRevision(chainId)?.keyId
            } else if (activeIdentity.provenance === "legacy-derived") {
              // A legacy identity is reproducible. If no encrypted copy can
              // be restored, ask for the derivation signature and verify it
              // against the active public identity.
              derivedWallet = await deriveWallet(chainId)
            } else if (activeIdentity.provenance === "random") {
              throw new Error(
                "This tab no longer has the random signing key. Choose Remember on this browser in Settings to replace it.",
              )
            } else {
              throw new Error("Autosign signer needs recovery before renewal")
            }
          } else {
            derivedWallet = await deriveWallet(chainId)
          }
          if (!isOwnerFenceCurrent(store, initiaAddress, ownerGeneration)) {
            throw new AutoSignCancelledError()
          }
          const shouldUpdateStayConnected =
            config.autoSignStorage !== "memory" &&
            shouldUpdateStayConnectedOnEnable({
              hasActiveIdentity: !!activeIdentity,
              createRandomCandidate,
              stayConnected,
            })
          const expectedRevision = getWalletRevision(chainId)?.storageRevision
          if (shouldUpdateStayConnected && expectedRevision === undefined) {
            throw new AutoSignCancelledError()
          }
          clearSigningClientCache(initiaAddress, chainId)

          const granteesToRevoke = resolveEnableAutoSignGranteeCandidates({
            currentGrantee: derivedWallet.address,
            expectedGrantee,
            activeGrantee: activeIdentity?.address,
            knownGrantees: identitiesBeforeDerivation.map((identity) => identity.address),
          })
          const revokeMessagesByGrantee = await Promise.all(
            granteesToRevoke.map((grantee) => fetchRevokeMessages({ chainId, grantee })),
          )
          if (!isOwnerFenceCurrent(store, initiaAddress, ownerGeneration)) {
            throw new AutoSignCancelledError()
          }
          const revokeMessages = revokeMessagesByGrantee.flat()
          const expiration =
            durationInMs === 0 ? undefined : addMilliseconds(new Date(), durationInMs)
          const grantPolicy = config.autoSignGrantPolicy?.[chainId]
          const grantMessages = buildAutoSignGrantMessages({
            granter: initiaAddress,
            grantee: derivedWallet.address,
            messageTypes: chainMsgTypes,
            authorization: grantPolicy?.authorization,
            expiration,
          })
          if (shouldUpdateStayConnected) {
            await assertSessionDowngradeHasNoPendingIdentities(
              stayConnected,
              getOwnerPendingIdentities,
            )
          }
          requestStarted = true
          const response = await requestTxBlock({
            messages: [...revokeMessages, ...grantMessages],
            chainId,
            internal: true,
          })
          chainConfirmed = true
          transactionHash = response.transactionHash
          if (!isOwnerFenceCurrent(store, initiaAddress, ownerGeneration)) {
            throw new AutoSignCancelledError()
          }
          if (shouldUpdateStayConnected) {
            await setStayConnected(chainId, stayConnected!, {
              alreadyLocked: true,
              expectedRevision,
            })
            if (!isOwnerFenceCurrent(store, initiaAddress, ownerGeneration)) {
              throw new AutoSignCancelledError()
            }
          }
          if (createRandomCandidate) {
            if (getWalletRevision(chainId)?.keyId !== pendingCandidateKeyId) {
              throw new AutoSignCancelledError()
            }
            await activateWallet(chainId, { mode: "persistent" })
          }
          await updateWalletObservation(chainId, {
            requestedDurationMs: durationInMs,
            observedExpiration: expiration?.toISOString(),
          })

          return {
            chainId,
            derivedWallet,
            owner: initiaAddress,
            ownerGeneration,
            request: pendingRequest,
            legacyExpectedAddress: expectedGrantee,
            legacyExpectedAddressAction: getLegacyExpectedAddressAction(
              getWalletProvenance(chainId),
            ),
          }
        })
      } catch (error) {
        if (chainConfirmed) {
          await invalidateAutoSignQueriesWithoutMasking(queryClient)
          throw new AutoSignConfirmedLocalPendingError(transactionHash!, error)
        }
        const notBroadcast = isTxNotBroadcast(error)
        if (
          pendingCandidateKeyId &&
          shouldDiscardPendingAutoSignCandidate({
            requestStarted,
            confirmedTxFailure: isConfirmedTxFailure(error),
            notBroadcast,
          })
        ) {
          await discardPendingIdentity(chainId, pendingCandidateKeyId).catch(() => undefined)
        }
        if (requestStarted && !notBroadcast) {
          await invalidateAutoSignQueriesWithoutMasking(queryClient)
        }
        throw error
      }
    },
    onSuccess: async ({
      chainId,
      derivedWallet,
      owner,
      ownerGeneration,
      request,
      legacyExpectedAddress,
      legacyExpectedAddressAction,
    }) => {
      if (isOwnerFenceCurrent(store, owner, ownerGeneration)) {
        if (legacyExpectedAddressAction === "store") {
          storeExpectedAddress(owner, chainId, derivedWallet.address)
        } else if (legacyExpectedAddressAction === "clear" && legacyExpectedAddress) {
          clearExpectedAddress(owner, chainId, legacyExpectedAddress)
        }
      }

      await refreshAutoSignQueriesWithoutMasking(queryClient)
      request.resolve()
    },
    onMutate: () => ({ request: pendingRequest }),
    onError: (error: Error, _input, context) => {
      context?.request?.reject(error)
    },
    onSettled: (_data, _error, _input, context) => {
      const request = context?.request
      if (request && store.get(pendingAutoSignRequestAtom) === request) {
        setPendingRequest(null)
        closeDrawer()
      }
    },
  })
}

/** Explicit owner-approved grant replacement used by the reconnect surface. */
export function useRenewAutoSign() {
  const initiaAddress = useInitiaAddress()
  const config = useConfig()
  const messageTypes = useAutoSignMessageTypes()
  const { requestTxBlock } = useTx()
  const queryClient = useQueryClient()
  const store = useStore()
  const fetchRevokeMessages = useFetchRevokeMessages()
  const {
    activateWallet,
    createWallet,
    deriveWallet,
    discardPendingIdentity,
    getOwnerPendingIdentities,
    getWalletIdentities,
    getWalletProvenance,
    getWalletRevision,
    restoreWallet,
    setStayConnected,
    updateWalletObservation,
  } = useDeriveWallet()

  return useMutation({
    mutationFn: async ({ chainId, durationInMs, stayConnected }: RenewAutoSignInput) => {
      if (!initiaAddress) throw new Error("Wallet not connected")
      const owner = initiaAddress
      const ownerGeneration = store.get(walletGenerationAtom)
      const chainMsgTypes = messageTypes[chainId]
      if (!chainMsgTypes?.length)
        throw new Error(`No message types configured for chain ${chainId}`)
      let pendingCandidateKeyId: string | undefined
      let requestStarted = false
      let chainConfirmed = false
      let transactionHash: string | undefined

      try {
        return await withAutoSignOperation(owner, async () => {
          if (!isOwnerFenceCurrent(store, owner, ownerGeneration)) {
            throw new AutoSignCancelledError()
          }
          const expectedGrantee = getExpectedAddress(owner, chainId)
          const identitiesBeforeRenewal = await getWalletIdentities(chainId)
          const activeIdentity = identitiesBeforeRenewal.find(
            (identity) => identity.state === "active",
          )
          if (!isOwnerFenceCurrent(store, owner, ownerGeneration)) {
            throw new AutoSignCancelledError()
          }

          let wallet = activeIdentity ? await restoreWallet(chainId) : undefined
          if (!isOwnerFenceCurrent(store, owner, ownerGeneration)) {
            throw new AutoSignCancelledError()
          }
          const createRandomCandidate = shouldCreateRenewRandomCandidate({
            activeIdentityProvenance: activeIdentity?.provenance,
            restoredWallet: !!wallet,
            stayConnected,
            autoSignStorage: config.autoSignStorage,
          })

          if (!wallet && createRandomCandidate) {
            wallet = await createWallet(chainId, { stayConnected: true, random: true })
            pendingCandidateKeyId = getWalletRevision(chainId)?.keyId
            if (!pendingCandidateKeyId) throw new AutoSignCancelledError()
          } else if (!wallet && activeIdentity?.provenance === "legacy-derived") {
            wallet = await deriveWallet(chainId)
          } else if (!wallet && activeIdentity?.provenance === "random") {
            throw new Error(
              "This tab no longer has the random signing key. Choose Remember on this browser in Settings to replace it.",
            )
          } else if (!wallet && activeIdentity) {
            throw new Error("Autosign signer needs recovery before renewal")
          } else if (!wallet && expectedGrantee) {
            wallet = await deriveWallet(chainId)
          } else if (!wallet) {
            throw new Error("No known autosign signer available for renewal")
          }

          if (!isOwnerFenceCurrent(store, owner, ownerGeneration)) {
            throw new AutoSignCancelledError()
          }
          const shouldUpdateStayConnected =
            shouldUpdateStayConnectedOnEnable({
              hasActiveIdentity: !!activeIdentity,
              createRandomCandidate,
              stayConnected,
            }) && config.autoSignStorage !== "memory"
          const expectedRevision = getWalletRevision(chainId)?.storageRevision
          if (shouldUpdateStayConnected && expectedRevision === undefined) {
            throw new AutoSignCancelledError()
          }

          const grantees = resolveEnableAutoSignGranteeCandidates({
            currentGrantee: wallet.address,
            expectedGrantee,
            activeGrantee: activeIdentity?.address,
            knownGrantees: identitiesBeforeRenewal.map((identity) => identity.address),
          })
          const revocations = await Promise.all(
            grantees.map((grantee) => fetchRevokeMessages({ chainId, grantee })),
          )
          if (!isOwnerFenceCurrent(store, owner, ownerGeneration)) {
            throw new AutoSignCancelledError()
          }
          const expiration =
            durationInMs === 0 ? undefined : addMilliseconds(new Date(), durationInMs)
          const grantPolicy = config.autoSignGrantPolicy?.[chainId]
          const grants = buildAutoSignGrantMessages({
            granter: owner,
            grantee: wallet.address,
            messageTypes: chainMsgTypes,
            authorization: grantPolicy?.authorization,
            expiration,
          })
          if (shouldUpdateStayConnected) {
            await assertSessionDowngradeHasNoPendingIdentities(
              stayConnected,
              getOwnerPendingIdentities,
            )
          }
          requestStarted = true
          const response = await requestTxBlock({
            messages: [...revocations.flat(), ...grants],
            chainId,
            internal: true,
          })
          chainConfirmed = true
          transactionHash = response.transactionHash
          if (!isOwnerFenceCurrent(store, owner, ownerGeneration)) {
            throw new AutoSignCancelledError()
          }
          if (shouldUpdateStayConnected) {
            await setStayConnected(chainId, stayConnected!, {
              alreadyLocked: true,
              expectedRevision,
            })
            if (!isOwnerFenceCurrent(store, owner, ownerGeneration)) {
              throw new AutoSignCancelledError()
            }
          }
          if (createRandomCandidate) {
            if (getWalletRevision(chainId)?.keyId !== pendingCandidateKeyId) {
              throw new AutoSignCancelledError()
            }
            await activateWallet(chainId, { mode: "persistent" })
          }
          await updateWalletObservation(chainId, {
            requestedDurationMs: durationInMs,
            observedExpiration: expiration?.toISOString(),
          })
          if (!isOwnerFenceCurrent(store, owner, ownerGeneration)) {
            throw new AutoSignCancelledError()
          }
          return {
            chainId,
            derivedWallet: wallet,
            owner,
            ownerGeneration,
            legacyExpectedAddress: expectedGrantee,
            legacyExpectedAddressAction: getLegacyExpectedAddressAction(
              getWalletProvenance(chainId),
            ),
          }
        })
      } catch (error) {
        if (chainConfirmed) {
          await invalidateAutoSignQueriesWithoutMasking(queryClient)
          throw new AutoSignConfirmedLocalPendingError(transactionHash!, error)
        }
        const notBroadcast = isTxNotBroadcast(error)
        if (
          pendingCandidateKeyId &&
          shouldDiscardPendingAutoSignCandidate({
            requestStarted,
            confirmedTxFailure: isConfirmedTxFailure(error),
            notBroadcast,
          })
        ) {
          await discardPendingIdentity(chainId, pendingCandidateKeyId).catch(() => undefined)
        }
        if (requestStarted && !notBroadcast) {
          await invalidateAutoSignQueriesWithoutMasking(queryClient)
        }
        throw error
      }
    },
    onSuccess: async ({
      chainId,
      derivedWallet,
      owner,
      ownerGeneration,
      legacyExpectedAddress,
      legacyExpectedAddressAction,
    }) => {
      if (isOwnerFenceCurrent(store, owner, ownerGeneration)) {
        if (legacyExpectedAddressAction === "store") {
          storeExpectedAddress(owner, chainId, derivedWallet.address)
        } else if (legacyExpectedAddressAction === "clear" && legacyExpectedAddress) {
          clearExpectedAddress(owner, chainId, legacyExpectedAddress)
        }
      }
      await refreshAutoSignQueriesWithoutMasking(queryClient)
    },
  })
}

/* Revoke AutoSign permissions and clear derived wallet from memory */
export function useDisableAutoSign(options?: { grantee: string; internal: boolean }) {
  const config = useConfig()
  const initiaAddress = useInitiaAddress()
  const {
    deleteWalletAfterConfirmedRevoke,
    getWallet,
    getWalletIdentities,
    pauseWallet,
    resumeWallet,
  } = useDeriveWallet()
  const { requestTxBlock } = useTx()
  const queryClient = useQueryClient()
  const fetchRevokeMessages = useFetchRevokeMessages()
  const { data: autoSignStatus, refetch: refetchAutoSignStatus } = useAutoSignStatus()

  return useMutation({
    mutationFn: async (chainId: string = config.defaultChainId) => {
      if (!initiaAddress) throw new Error("Wallet not connected")

      return withAutoSignOperation(initiaAddress, async () => {
        const derivedWallet = getWallet(chainId)
        const localIdentities = await getWalletIdentities(chainId)
        const statusGrantee = autoSignStatus?.granteeByChain[chainId]
        const expectedGrantee = getExpectedAddress(initiaAddress, chainId)
        let refetchedStatusGrantee: string | undefined

        if (!options?.grantee) {
          const refreshedStatus = await refetchAutoSignStatus()
          refetchedStatusGrantee = refreshedStatus.data?.granteeByChain[chainId]
        }

        const granteeCandidates = resolveDisableAutoSignGranteeCandidates({
          explicitGrantee: options?.grantee,
          cachedDerivedAddress: derivedWallet?.address,
          activeIdentityAddress: localIdentities.find(({ state }) => state === "active")?.address,
          localIdentityAddresses: localIdentities.map(({ address }) => address),
          // A query match alone cannot prove an app owns a grantee. The
          // non-explicit disable flow only adopts status data that matches the
          // locally recorded deterministic identity.
          statusGrantee:
            expectedGrantee && statusGrantee === expectedGrantee ? statusGrantee : undefined,
          refetchedStatusGrantee:
            expectedGrantee && refetchedStatusGrantee === expectedGrantee
              ? refetchedStatusGrantee
              : undefined,
        })

        if (granteeCandidates.length === 0) {
          throw new Error("No grantee address available")
        }

        const revocationsByGrantee = await Promise.all(
          granteeCandidates.map(async (grantee) => ({
            grantee,
            messages: await fetchRevokeMessages({ chainId, grantee }),
          })),
        )
        const messages = revocationsByGrantee.flatMap(({ messages }) => messages)

        if (messages.length === 0) {
          return { chainId, didBroadcast: false }
        }
        const granteesWithRevocations = new Set(
          revocationsByGrantee
            .filter(({ messages }) => messages.length > 0)
            .map(({ grantee }) => grantee),
        )
        const localTargets = localIdentities.filter(({ address }) =>
          granteesWithRevocations.has(address),
        )
        const activeTarget = localTargets.find(({ state }) => state === "active")
        const shouldPauseCachedWallet =
          !activeTarget && !!derivedWallet && granteesWithRevocations.has(derivedWallet.address)
        const pausedKeyId = activeTarget?.keyId
        const pausedWallet =
          activeTarget || shouldPauseCachedWallet
            ? await pauseWallet(chainId, pausedKeyId)
            : undefined
        let chainConfirmed = false
        let transactionHash: string | undefined
        try {
          const response = await requestTxBlock({ messages, chainId, internal: options?.internal })
          chainConfirmed = true
          transactionHash = response.transactionHash
          for (const target of localTargets) {
            await deleteWalletAfterConfirmedRevoke(
              chainId,
              target.keyId === (pausedKeyId ?? pausedWallet?.keyId) ? pausedWallet : undefined,
              target.keyId,
            )
          }
          if (localTargets.length === 0 && pausedWallet) {
            await deleteWalletAfterConfirmedRevoke(chainId, pausedWallet)
          }
          for (const grantee of granteesWithRevocations) {
            clearExpectedAddress(initiaAddress, chainId, grantee)
          }
          return {
            chainId,
            didBroadcast: true,
            pausedLocalWallet: !!pausedWallet || !!pausedKeyId,
            transactionHash,
          }
        } catch (error) {
          if (chainConfirmed) {
            await invalidateAutoSignQueriesWithoutMasking(queryClient)
            throw new AutoSignConfirmedLocalPendingError(transactionHash!, error)
          }
          const notBroadcast = isTxNotBroadcast(error)
          if ((pausedWallet || pausedKeyId) && (isConfirmedTxFailure(error) || notBroadcast)) {
            await resumeWallet(chainId, pausedWallet, pausedKeyId).catch(() => undefined)
          }
          if (!notBroadcast) {
            await invalidateAutoSignQueriesWithoutMasking(queryClient)
          }
          throw error
        }
      })
    },
    onSuccess: async () => {
      await refreshAutoSignQueriesWithoutMasking(queryClient)
    },
  })
}
