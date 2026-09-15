import { beforeEach, describe, expect, it, vi } from "vitest"
import { markTxNotBroadcast, TxExecutionError } from "@/data/errors"
import { AutoSignPendingResolutionError, AutoSignStorageError } from "./storage"
import { activeWalletOwnerAtom, pendingAutoSignRequestAtom, walletGenerationAtom } from "./store"

const mocks = vi.hoisted(() => ({
  activateWallet: vi.fn(),
  clearExpectedAddress: vi.fn(),
  createWallet: vi.fn(),
  deriveWallet: vi.fn(),
  discardPendingIdentity: vi.fn(),
  fetchFeegrant: vi.fn(),
  fetchGrants: vi.fn(),
  getExpectedAddress: vi.fn(),
  getStayConnected: vi.fn(),
  getOwnerPendingIdentities: vi.fn(),
  getWallet: vi.fn(),
  getWalletIdentities: vi.fn(),
  getWalletProvenance: vi.fn(),
  getWalletRevision: vi.fn(),
  invalidateQueries: vi.fn(),
  deleteWalletAfterConfirmedRevoke: vi.fn(),
  pauseWallet: vi.fn(),
  resumeWallet: vi.fn(),
  refetchAutoSignStatus: vi.fn(),
  requestTxBlock: vi.fn(),
  restoreWallet: vi.fn(),
  setPendingRequest: vi.fn(),
  setStayConnected: vi.fn(),
  updateWalletObservation: vi.fn(),
  pendingRequest: {
    owner: "init1owner",
    chainId: "initiation-2",
    defaultDuration: 60_000,
    resolve: vi.fn(),
    reject: vi.fn(),
  },
  activeOwner: "init1owner",
  generation: 7,
}))

vi.mock("jotai", async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    useAtom: () => [mocks.pendingRequest, mocks.setPendingRequest],
    useStore: () => ({
      get: (atom: unknown) => {
        if (atom === activeWalletOwnerAtom) return mocks.activeOwner
        if (atom === walletGenerationAtom) return mocks.generation
        if (atom === pendingAutoSignRequestAtom) return mocks.pendingRequest
        return undefined
      },
    }),
  }
})

vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: unknown) => options,
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))

vi.mock("@/data/config", () => ({
  useConfig: () => ({
    autoSignStorage: "browser",
    autoSignGrantPolicy: {},
    defaultChainId: "initiation-2",
  }),
}))

vi.mock("@/data/tx", () => ({
  useTx: () => ({ requestTxBlock: mocks.requestTxBlock }),
}))

vi.mock("@/data/ui", () => ({
  useDrawer: () => ({ closeDrawer: vi.fn() }),
}))

vi.mock("@/public/data/hooks", () => ({
  useInitiaAddress: () => "init1owner",
}))

vi.mock("./fetch", () => ({
  getFeegrantAllowedMessages: vi.fn(),
  getFeegrantExpiration: vi.fn(),
  useAutoSignApi: () => ({
    fetchFeegrant: mocks.fetchFeegrant,
    fetchGrants: mocks.fetchGrants,
  }),
}))

vi.mock("./validation", () => ({
  autoSignQueryKeys: {
    expirations: { _def: ["autosign", "expirations"] },
    grants: { _def: ["autosign", "grants"] },
  },
  useAutoSignMessageTypes: () => ({
    "initiation-2": ["/cosmos.bank.v1beta1.MsgSend"],
  }),
  useAutoSignStatus: () => ({
    data: undefined,
    refetch: mocks.refetchAutoSignStatus,
  }),
}))

vi.mock("./wallet", () => ({
  clearExpectedAddress: mocks.clearExpectedAddress,
  getExpectedAddress: mocks.getExpectedAddress,
  storeExpectedAddress: vi.fn(),
  useDeriveWallet: () => ({
    activateWallet: mocks.activateWallet,
    createWallet: mocks.createWallet,
    deriveWallet: mocks.deriveWallet,
    discardPendingIdentity: mocks.discardPendingIdentity,
    deleteWalletAfterConfirmedRevoke: mocks.deleteWalletAfterConfirmedRevoke,
    getOwnerPendingIdentities: mocks.getOwnerPendingIdentities,
    getStayConnected: mocks.getStayConnected,
    getWallet: mocks.getWallet,
    getWalletProvenance: mocks.getWalletProvenance,
    getWalletRevision: mocks.getWalletRevision,
    getWalletIdentities: mocks.getWalletIdentities,
    restoreWallet: mocks.restoreWallet,
    pauseWallet: mocks.pauseWallet,
    resumeWallet: mocks.resumeWallet,
    setStayConnected: mocks.setStayConnected,
    updateWalletObservation: mocks.updateWalletObservation,
  }),
}))

import { useDisableAutoSign, useEnableAutoSign, useRenewAutoSign } from "./actions"

interface EnableMutation {
  mutationFn: (input: { durationInMs: number; stayConnected?: boolean }) => Promise<unknown>
  onSuccess: (result: unknown) => Promise<void>
  onMutate: () => { request: typeof mocks.pendingRequest }
  onError: (
    error: Error,
    input: { durationInMs: number; stayConnected?: boolean },
    context: { request: typeof mocks.pendingRequest },
  ) => void
}

interface RenewMutation {
  mutationFn: (input: {
    chainId: string
    durationInMs: number
    stayConnected?: boolean
  }) => Promise<unknown>
  onSuccess: (result: unknown) => Promise<void>
}

interface DisableMutation {
  mutationFn: (chainId?: string) => Promise<unknown>
  onSuccess: (result: unknown) => Promise<void>
}

const input = {
  chainId: "initiation-2",
  durationInMs: 60_000,
  stayConnected: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.activeOwner = "init1owner"
  mocks.generation = 7
  mocks.getExpectedAddress.mockReturnValue(undefined)
  mocks.restoreWallet.mockResolvedValue(undefined)
  mocks.getStayConnected.mockResolvedValue(true)
  mocks.getOwnerPendingIdentities.mockResolvedValue([])
  mocks.getWalletIdentities.mockResolvedValue([
    { address: "init1oldrandom", provenance: "random", state: "active" },
    { address: "init1forgotten", provenance: "random", state: "forgotten" },
  ])
  mocks.createWallet.mockResolvedValue({
    address: "init1newrandom",
    publicKey: new Uint8Array(),
  })
  mocks.getWalletRevision.mockReturnValue({ keyId: "replacement-key", storageRevision: 11 })
  mocks.getWalletProvenance.mockReturnValue("random")
  mocks.fetchFeegrant.mockResolvedValue(undefined)
  mocks.fetchGrants.mockResolvedValue([{ authorization: { msg: "/cosmos.bank.v1beta1.MsgSend" } }])
  mocks.activateWallet.mockResolvedValue(undefined)
  mocks.discardPendingIdentity.mockResolvedValue(undefined)
  mocks.setStayConnected.mockResolvedValue(undefined)
  mocks.updateWalletObservation.mockResolvedValue(undefined)
  mocks.invalidateQueries.mockResolvedValue(undefined)
  mocks.refetchAutoSignStatus.mockResolvedValue({ data: undefined })
  mocks.deleteWalletAfterConfirmedRevoke.mockResolvedValue(undefined)
  mocks.pauseWallet.mockResolvedValue(undefined)
  mocks.resumeWallet.mockResolvedValue(undefined)
})

function useRenewMutationForTest() {
  return useRenewAutoSign() as unknown as RenewMutation
}

function useEnableMutationForTest() {
  return useEnableAutoSign() as unknown as EnableMutation
}

function useDisableMutationForTest() {
  return useDisableAutoSign() as unknown as DisableMutation
}

describe("useEnableAutoSign random signer recovery", () => {
  it("replaces a forgotten random signer through an explicit remembered enable", async () => {
    mocks.getWalletIdentities.mockResolvedValue([
      { address: "init1forgotten", provenance: "random", state: "forgotten" },
    ])
    mocks.requestTxBlock.mockResolvedValue({ code: 0, rawLog: "" })

    await useEnableMutationForTest().mutationFn(input)

    expect(mocks.createWallet).toHaveBeenCalledWith("initiation-2", {
      stayConnected: true,
      random: true,
    })
    expect(mocks.fetchGrants).toHaveBeenCalledWith("initiation-2", "init1forgotten")
    expect(mocks.activateWallet).toHaveBeenCalledWith("initiation-2", { mode: "persistent" })
  })

  it("clears the captured legacy mirror after granting a random replacement", async () => {
    mocks.getExpectedAddress.mockReturnValue("init1legacy")
    mocks.getWalletIdentities.mockResolvedValue([
      { address: "init1oldrandom", provenance: "random", state: "active" },
    ])
    mocks.requestTxBlock.mockResolvedValue({ code: 0, rawLog: "" })
    const mutation = useEnableMutationForTest()

    const result = await mutation.mutationFn(input)
    await mutation.onSuccess(result)

    expect(mocks.clearExpectedAddress).toHaveBeenCalledWith(
      "init1owner",
      "initiation-2",
      "init1legacy",
    )
  })

  it("settles the accepted request after success even when its owner fence changes later", async () => {
    mocks.getWalletIdentities.mockResolvedValue([])
    mocks.deriveWallet.mockResolvedValue({
      address: "init1legacy",
      publicKey: new Uint8Array(),
    })
    mocks.getWalletProvenance.mockReturnValue("legacy-derived")
    mocks.requestTxBlock.mockResolvedValue({ transactionHash: "ENABLE123", code: 0, rawLog: "" })
    const mutation = useEnableMutationForTest()
    const result = await mutation.mutationFn({ durationInMs: 60_000 })
    mocks.activeOwner = "init1other"
    mocks.invalidateQueries.mockRejectedValue(new Error("cache unavailable"))

    await mutation.onSuccess(result)

    expect(mocks.pendingRequest.resolve).toHaveBeenCalledOnce()
  })

  it("rejects the accepted request with the confirmed-chain local-pending outcome", async () => {
    mocks.requestTxBlock.mockResolvedValue({
      code: 0,
      rawLog: "",
      transactionHash: "ENABLE123",
    })
    mocks.activateWallet.mockRejectedValue(
      new AutoSignStorageError(
        "Change Stay connected from the original tab or Forget the old signer in Settings",
      ),
    )
    const mutation = useEnableMutationForTest()
    const context = mutation.onMutate()
    const input = { durationInMs: 60_000, stayConnected: true }
    const error = (await mutation.mutationFn(input).catch((cause) => cause)) as Error

    mutation.onError(error, input, context)

    expect(error).toMatchObject({
      name: "AutoSignConfirmedLocalPendingError",
      transactionHash: "ENABLE123",
    })
    expect(error.message).toContain(
      "Change Stay connected from the original tab or Forget the old signer in Settings",
    )
    expect(mocks.pendingRequest.reject).toHaveBeenCalledWith(error)
    expect(mocks.discardPendingIdentity).not.toHaveBeenCalled()
    expect(mocks.invalidateQueries).toHaveBeenCalledTimes(2)
  })

  it("waits for a successful status refresh before resolving the accepted request", async () => {
    mocks.getWalletIdentities.mockResolvedValue([])
    mocks.deriveWallet.mockResolvedValue({
      address: "init1legacy",
      publicKey: new Uint8Array(),
    })
    mocks.getWalletProvenance.mockReturnValue("legacy-derived")
    mocks.requestTxBlock.mockResolvedValue({ transactionHash: "ENABLE123", code: 0, rawLog: "" })
    let finishRefresh!: () => void
    mocks.invalidateQueries.mockReturnValue(
      new Promise<void>((resolve) => {
        finishRefresh = resolve
      }),
    )
    const mutation = useEnableMutationForTest()
    const result = await mutation.mutationFn({ durationInMs: 60_000 })
    const success = mutation.onSuccess(result)
    await Promise.resolve()

    expect(mocks.pendingRequest.resolve).not.toHaveBeenCalled()
    finishRefresh()
    await success
    expect(mocks.pendingRequest.resolve).toHaveBeenCalledOnce()
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["autosign", "expirations"],
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["autosign", "grants"] })
  })

  it("rejects the originally accepted request from mutation context after hook options rerender", () => {
    const firstRequest = mocks.pendingRequest
    const originalMutation = useEnableMutationForTest()
    const context = originalMutation.onMutate()
    const newerReject = vi.fn()
    mocks.pendingRequest = { ...mocks.pendingRequest, reject: newerReject }
    const rerenderedMutation = useEnableMutationForTest()
    const error = new Error("approval failed")

    rerenderedMutation.onError(error, { durationInMs: 60_000 }, context)

    expect(firstRequest.reject).toHaveBeenCalledWith(error)
    expect(newerReject).not.toHaveBeenCalled()
    mocks.pendingRequest = firstRequest
  })
})

describe("restored signer persistence changes", () => {
  const operations = [
    [
      "enable",
      () => useEnableMutationForTest().mutationFn({ durationInMs: 60_000, stayConnected: false }),
    ],
    ["renew", () => useRenewMutationForTest().mutationFn({ ...input, stayConnected: false })],
  ] as const

  beforeEach(() => {
    mocks.restoreWallet.mockResolvedValue({
      address: "init1oldrandom",
      publicKey: new Uint8Array(),
    })
  })

  it.each(operations)(
    "defers %s persistence changes until the owner transaction succeeds",
    async (_operation, mutate) => {
      mocks.requestTxBlock.mockRejectedValue(
        new TxExecutionError("transaction failed", 5, "txhash"),
      )

      await expect(mutate()).rejects.toThrow("transaction failed")

      expect(mocks.setStayConnected).not.toHaveBeenCalled()
    },
  )

  it.each(operations)(
    "applies %s persistence changes after transaction confirmation",
    async (_operation, mutate) => {
      mocks.requestTxBlock.mockResolvedValue({ code: 0, rawLog: "" })

      await mutate()

      expect(mocks.setStayConnected).toHaveBeenCalledWith("initiation-2", false, {
        alreadyLocked: true,
        expectedRevision: 11,
      })
      expect(mocks.requestTxBlock.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.setStayConnected.mock.invocationCallOrder[0]!,
      )
    },
  )

  it("fails a session downgrade before opening the transaction when pending keys need resolution", async () => {
    mocks.getOwnerPendingIdentities.mockResolvedValue([
      { chainId: "pending-chain", keyId: "pending-key", state: "pending" },
    ])

    await expect(
      useRenewMutationForTest().mutationFn({ ...input, stayConnected: false }),
    ).rejects.toBeInstanceOf(AutoSignPendingResolutionError)

    expect(mocks.requestTxBlock).not.toHaveBeenCalled()
    expect(mocks.setStayConnected).not.toHaveBeenCalled()
  })

  it("derives a new legacy signer in the requested mode and confirms the preference after the transaction", async () => {
    mocks.getExpectedAddress.mockReturnValue("init1legacy")
    mocks.getWalletIdentities.mockResolvedValue([])
    mocks.deriveWallet.mockResolvedValue({
      address: "init1legacy",
      publicKey: new Uint8Array(),
    })
    mocks.getWalletProvenance.mockReturnValue("legacy-derived")
    mocks.requestTxBlock.mockResolvedValue({ transactionHash: "LEGACY123", code: 0, rawLog: "" })

    await useEnableMutationForTest().mutationFn({ durationInMs: 60_000, stayConnected: false })

    expect(mocks.deriveWallet).toHaveBeenCalledWith("initiation-2", { stayConnected: false })
    expect(mocks.requestTxBlock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.setStayConnected.mock.invocationCallOrder[0]!,
    )
    expect(mocks.setStayConnected).toHaveBeenCalledWith("initiation-2", false, {
      alreadyLocked: true,
      expectedRevision: 11,
    })
    expect(mocks.deleteWalletAfterConfirmedRevoke).not.toHaveBeenCalled()
  })
})

describe("useEnableAutoSign new tab-only signer", () => {
  beforeEach(() => {
    mocks.getWalletIdentities.mockResolvedValue([])
    mocks.deriveWallet.mockResolvedValue({
      address: "init1legacy",
      publicKey: new Uint8Array(),
    })
    mocks.getWalletProvenance.mockReturnValue("legacy-derived")
    mocks.getWalletRevision.mockReturnValue({ keyId: "fresh-key", storageRevision: 11 })
  })

  it("discards the new key when the grant is rejected before broadcast", async () => {
    const rejection = markTxNotBroadcast(Object.assign(new Error("User rejected"), { code: 4001 }))
    mocks.requestTxBlock.mockRejectedValue(rejection)

    await expect(
      useEnableMutationForTest().mutationFn({ durationInMs: 60_000, stayConnected: false }),
    ).rejects.toBe(rejection)

    expect(mocks.deriveWallet).toHaveBeenCalledWith("initiation-2", { stayConnected: false })
    expect(mocks.deleteWalletAfterConfirmedRevoke).toHaveBeenCalledWith(
      "initiation-2",
      undefined,
      "fresh-key",
    )
    expect(mocks.setStayConnected).not.toHaveBeenCalled()
  })

  it("discards the new key after a confirmed transaction failure", async () => {
    mocks.requestTxBlock.mockRejectedValue(new TxExecutionError("grant failed", 5, "txhash"))

    await expect(
      useEnableMutationForTest().mutationFn({ durationInMs: 60_000, stayConnected: false }),
    ).rejects.toThrow("grant failed")

    expect(mocks.deleteWalletAfterConfirmedRevoke).toHaveBeenCalledWith(
      "initiation-2",
      undefined,
      "fresh-key",
    )
  })

  it("follows the saved tab-only preference when the caller omits the mode", async () => {
    mocks.getStayConnected.mockResolvedValue(false)
    const rejection = markTxNotBroadcast(Object.assign(new Error("User rejected"), { code: 4001 }))
    mocks.requestTxBlock.mockRejectedValue(rejection)

    await expect(useEnableMutationForTest().mutationFn({ durationInMs: 60_000 })).rejects.toBe(
      rejection,
    )

    expect(mocks.deriveWallet).toHaveBeenCalledWith("initiation-2", { stayConnected: undefined })
    expect(mocks.deleteWalletAfterConfirmedRevoke).toHaveBeenCalledWith(
      "initiation-2",
      undefined,
      "fresh-key",
    )
  })

  it("retains the new key when the broadcast outcome is unknown", async () => {
    mocks.requestTxBlock.mockRejectedValue(new Error("confirmation timed out"))

    await expect(
      useEnableMutationForTest().mutationFn({ durationInMs: 60_000, stayConnected: false }),
    ).rejects.toThrow("confirmation timed out")

    expect(mocks.deleteWalletAfterConfirmedRevoke).not.toHaveBeenCalled()
  })

  it("keeps a new remembered key after a definite failure", async () => {
    mocks.getExpectedAddress.mockReturnValue("init1legacy")
    const rejection = markTxNotBroadcast(Object.assign(new Error("User rejected"), { code: 4001 }))
    mocks.requestTxBlock.mockRejectedValue(rejection)

    await expect(
      useEnableMutationForTest().mutationFn({ durationInMs: 60_000, stayConnected: true }),
    ).rejects.toBe(rejection)

    expect(mocks.deriveWallet).toHaveBeenCalledWith("initiation-2", { stayConnected: true })
    expect(mocks.deleteWalletAfterConfirmedRevoke).not.toHaveBeenCalled()
  })
})

describe("useRenewAutoSign random signer recovery", () => {
  it("revokes the old grantee, grants the replacement, then activates it after success", async () => {
    mocks.requestTxBlock.mockResolvedValue({ code: 0, rawLog: "" })

    await useRenewMutationForTest().mutationFn(input)

    const request = mocks.requestTxBlock.mock.calls[0]![0] as {
      messages: Array<{ typeUrl: string; value: { grantee?: string } }>
    }
    expect(request.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          typeUrl: "/cosmos.authz.v1beta1.MsgRevoke",
          value: expect.objectContaining({ grantee: "init1oldrandom" }),
        }),
        expect.objectContaining({
          typeUrl: "/cosmos.authz.v1beta1.MsgRevoke",
          value: expect.objectContaining({ grantee: "init1forgotten" }),
        }),
        expect.objectContaining({
          typeUrl: "/cosmos.authz.v1beta1.MsgGrant",
          value: expect.objectContaining({ grantee: "init1newrandom" }),
        }),
      ]),
    )
    expect(mocks.activateWallet).toHaveBeenCalledWith("initiation-2", { mode: "persistent" })
    expect(mocks.requestTxBlock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.activateWallet.mock.invocationCallOrder[0]!,
    )
    expect(mocks.discardPendingIdentity).not.toHaveBeenCalled()
  })

  it("clears the captured legacy mirror after granting a random replacement", async () => {
    mocks.getExpectedAddress.mockReturnValue("init1legacy")
    mocks.requestTxBlock.mockResolvedValue({ code: 0, rawLog: "" })
    const mutation = useRenewMutationForTest()

    const result = await mutation.mutationFn(input)
    await mutation.onSuccess(result)

    expect(mocks.clearExpectedAddress).toHaveBeenCalledWith(
      "init1owner",
      "initiation-2",
      "init1legacy",
    )
  })

  it("revokes the old grantee and discards the pending key after a confirmed failure", async () => {
    mocks.requestTxBlock.mockRejectedValue(new TxExecutionError("renewal failed", 5, "txhash"))

    await expect(useRenewMutationForTest().mutationFn(input)).rejects.toThrow("renewal failed")

    expect(mocks.fetchGrants).toHaveBeenCalledWith("initiation-2", "init1oldrandom")
    expect(mocks.requestTxBlock).toHaveBeenCalledOnce()
    expect(mocks.activateWallet).not.toHaveBeenCalled()
    expect(mocks.discardPendingIdentity).toHaveBeenCalledWith("initiation-2", "replacement-key")
    expect(mocks.setStayConnected).not.toHaveBeenCalled()
    expect(mocks.invalidateQueries).toHaveBeenCalledTimes(2)
  })

  it("retains the pending key when the broadcast outcome is unknown", async () => {
    mocks.requestTxBlock.mockRejectedValue(new Error("confirmation timed out"))

    await expect(useRenewMutationForTest().mutationFn(input)).rejects.toThrow(
      "confirmation timed out",
    )

    expect(mocks.fetchGrants).toHaveBeenCalledWith("initiation-2", "init1oldrandom")
    expect(mocks.activateWallet).not.toHaveBeenCalled()
    expect(mocks.discardPendingIdentity).not.toHaveBeenCalled()
    expect(mocks.invalidateQueries).toHaveBeenCalledTimes(2)
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["autosign", "expirations"],
      refetchType: "none",
    })
  })

  it("does not discard a pending key from a spoofable post-broadcast rejection message", async () => {
    mocks.requestTxBlock.mockRejectedValue(new Error("RPC says user rejected after forwarding"))

    await expect(useRenewMutationForTest().mutationFn(input)).rejects.toThrow("user rejected")

    expect(mocks.discardPendingIdentity).not.toHaveBeenCalled()
    expect(mocks.invalidateQueries).toHaveBeenCalledTimes(2)
  })

  it("discards a pending key when the transaction boundary proves it was not broadcast", async () => {
    const rejection = markTxNotBroadcast(Object.assign(new Error("User rejected"), { code: 4001 }))
    mocks.requestTxBlock.mockRejectedValue(rejection)

    await expect(useRenewMutationForTest().mutationFn(input)).rejects.toBe(rejection)

    expect(mocks.discardPendingIdentity).toHaveBeenCalledWith("initiation-2", "replacement-key")
    expect(mocks.invalidateQueries).not.toHaveBeenCalled()
  })

  it("reports confirmed-chain local activation failure with the transaction hash", async () => {
    mocks.requestTxBlock.mockResolvedValue({
      code: 0,
      rawLog: "",
      transactionHash: "ABC123",
    })
    const storageError = new AutoSignStorageError("activation failed")
    mocks.activateWallet.mockRejectedValue(storageError)
    mocks.invalidateQueries.mockRejectedValue(new Error("query cache unavailable"))

    const error = await useRenewMutationForTest()
      .mutationFn(input)
      .catch((cause) => cause)

    expect(error).toMatchObject({
      name: "AutoSignConfirmedLocalPendingError",
      transactionHash: "ABC123",
      cause: storageError,
    })
    expect(mocks.discardPendingIdentity).not.toHaveBeenCalled()
    expect(mocks.invalidateQueries).toHaveBeenCalledTimes(2)
  })

  it("keeps tab-only renewal from replacing an unavailable random signer", async () => {
    await expect(
      useRenewMutationForTest().mutationFn({ ...input, stayConnected: false }),
    ).rejects.toThrow("Choose Remember on this browser in Settings to replace it")

    expect(mocks.createWallet).not.toHaveBeenCalled()
    expect(mocks.requestTxBlock).not.toHaveBeenCalled()
    expect(mocks.activateWallet).not.toHaveBeenCalled()
  })
})

describe("useDisableAutoSign local identity lifecycle", () => {
  const identities = [
    { address: "init1active", keyId: "active-key", provenance: "random", state: "active" },
    { address: "init1paused", keyId: "paused-key", provenance: "random", state: "paused" },
    { address: "init1pending", keyId: "pending-key", provenance: "random", state: "pending" },
    {
      address: "init1forgotten",
      keyId: "forgotten-key",
      provenance: "random",
      state: "forgotten",
    },
  ]

  beforeEach(() => {
    mocks.getWallet.mockReturnValue(undefined)
    mocks.getWalletIdentities.mockResolvedValue(identities)
    mocks.fetchGrants.mockResolvedValue([
      { authorization: { msg: "/cosmos.bank.v1beta1.MsgSend" } },
    ])
    mocks.pauseWallet.mockResolvedValue({ keyId: "active-key", privateKey: new Uint8Array() })
  })

  it("revokes and deletes exact active, paused, pending, and forgotten local identities", async () => {
    mocks.requestTxBlock.mockResolvedValue({ transactionHash: "REVOKE123", code: 0, rawLog: "" })

    await useDisableMutationForTest().mutationFn("initiation-2")

    expect(mocks.requestTxBlock).toHaveBeenCalledOnce()
    expect(mocks.pauseWallet).toHaveBeenCalledWith("initiation-2", "active-key")
    expect(mocks.deleteWalletAfterConfirmedRevoke).toHaveBeenCalledTimes(4)
    expect(mocks.deleteWalletAfterConfirmedRevoke).toHaveBeenCalledWith(
      "initiation-2",
      expect.objectContaining({ keyId: "active-key" }),
      "active-key",
    )
    for (const identity of identities.slice(1)) {
      expect(mocks.deleteWalletAfterConfirmedRevoke).toHaveBeenCalledWith(
        "initiation-2",
        undefined,
        identity.keyId,
      )
    }
  })

  it("retains all local identities stopped when the revoke broadcast is ambiguous", async () => {
    mocks.requestTxBlock.mockRejectedValue(new Error("confirmation timed out"))

    await expect(useDisableMutationForTest().mutationFn("initiation-2")).rejects.toThrow(
      "confirmation timed out",
    )

    expect(mocks.deleteWalletAfterConfirmedRevoke).not.toHaveBeenCalled()
    expect(mocks.resumeWallet).not.toHaveBeenCalled()
    expect(mocks.invalidateQueries).toHaveBeenCalledTimes(2)
  })

  it("resumes only a newly paused active identity when broadcast never started", async () => {
    const rejection = markTxNotBroadcast(Object.assign(new Error("User rejected"), { code: 4001 }))
    mocks.requestTxBlock.mockRejectedValue(rejection)

    await expect(useDisableMutationForTest().mutationFn("initiation-2")).rejects.toBe(rejection)

    expect(mocks.resumeWallet).toHaveBeenCalledWith(
      "initiation-2",
      expect.objectContaining({ keyId: "active-key" }),
      "active-key",
    )
    expect(mocks.invalidateQueries).not.toHaveBeenCalled()
  })

  it("does not erase a pending identity when the indexer reports no revoke messages", async () => {
    mocks.getWalletIdentities.mockResolvedValue([identities[2]])
    mocks.fetchGrants.mockResolvedValue([])

    await useDisableMutationForTest().mutationFn("initiation-2")

    expect(mocks.requestTxBlock).not.toHaveBeenCalled()
    expect(mocks.deleteWalletAfterConfirmedRevoke).not.toHaveBeenCalled()
  })

  it("passes a paused cached pending copy to confirmed cleanup for zeroization", async () => {
    const pending = identities[2]
    const pausedPending = {
      address: pending.address,
      keyId: pending.keyId,
      privateKey: new Uint8Array([1, 2, 3]),
    }
    mocks.getWalletIdentities.mockResolvedValue([pending])
    mocks.getWallet.mockReturnValue({ address: pending.address })
    mocks.pauseWallet.mockResolvedValue(pausedPending)
    mocks.requestTxBlock.mockResolvedValue({ transactionHash: "REVOKE123", code: 0, rawLog: "" })

    await useDisableMutationForTest().mutationFn("initiation-2")

    expect(mocks.deleteWalletAfterConfirmedRevoke).toHaveBeenCalledWith(
      "initiation-2",
      pausedPending,
      pending.keyId,
    )
  })
})
