import { beforeEach, describe, expect, it, vi } from "vitest"
import { activeWalletOwnerAtom, pendingAutoSignRequestAtom, walletGenerationAtom } from "./store"

const mocks = vi.hoisted(() => ({
  activateWallet: vi.fn(),
  clearExpectedAddress: vi.fn(),
  createWallet: vi.fn(),
  deriveWallet: vi.fn(),
  discardPendingIdentity: vi.fn(),
  fetchFeegrant: vi.fn(),
  fetchGrants: vi.fn(),
  getActiveIdentity: vi.fn(),
  getExpectedAddress: vi.fn(),
  getStayConnected: vi.fn(),
  getWalletIdentities: vi.fn(),
  getWalletProvenance: vi.fn(),
  getWalletRevision: vi.fn(),
  invalidateQueries: vi.fn(),
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
}))

vi.mock("jotai", async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    useAtom: () => [mocks.pendingRequest, mocks.setPendingRequest],
    useStore: () => ({
      get: (atom: unknown) => {
        if (atom === activeWalletOwnerAtom) return "init1owner"
        if (atom === walletGenerationAtom) return 7
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
  useAutoSignStatus: vi.fn(),
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
    getActiveIdentity: mocks.getActiveIdentity,
    getStayConnected: mocks.getStayConnected,
    getWalletProvenance: mocks.getWalletProvenance,
    getWalletRevision: mocks.getWalletRevision,
    getWalletIdentities: mocks.getWalletIdentities,
    restoreWallet: mocks.restoreWallet,
    setStayConnected: mocks.setStayConnected,
    updateWalletObservation: mocks.updateWalletObservation,
  }),
}))

import { useEnableAutoSign, useRenewAutoSign } from "./actions"

interface EnableMutation {
  mutationFn: (input: { durationInMs: number; stayConnected?: boolean }) => Promise<unknown>
  onSuccess: (result: unknown) => Promise<void>
}

interface RenewMutation {
  mutationFn: (input: {
    chainId: string
    durationInMs: number
    stayConnected?: boolean
  }) => Promise<unknown>
  onSuccess: (result: unknown) => Promise<void>
}

const input = {
  chainId: "initiation-2",
  durationInMs: 60_000,
  stayConnected: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getExpectedAddress.mockReturnValue(undefined)
  mocks.getActiveIdentity.mockResolvedValue({
    address: "init1oldrandom",
    provenance: "random",
  })
  mocks.getWalletIdentities.mockResolvedValue([
    { address: "init1oldrandom", provenance: "random", state: "active" },
  ])
  mocks.restoreWallet.mockResolvedValue(undefined)
  mocks.getStayConnected.mockResolvedValue(true)
  mocks.createWallet.mockResolvedValue({
    address: "init1newrandom",
    publicKey: new Uint8Array(),
  })
  mocks.getWalletRevision.mockReturnValue({ keyId: "replacement-key" })
  mocks.getWalletProvenance.mockReturnValue("random")
  mocks.fetchFeegrant.mockResolvedValue(undefined)
  mocks.fetchGrants.mockResolvedValue([{ authorization: { msg: "/cosmos.bank.v1beta1.MsgSend" } }])
  mocks.activateWallet.mockResolvedValue(undefined)
  mocks.discardPendingIdentity.mockResolvedValue(undefined)
  mocks.setStayConnected.mockResolvedValue(undefined)
  mocks.updateWalletObservation.mockResolvedValue(undefined)
})

function useRenewMutationForTest() {
  return useRenewAutoSign() as unknown as RenewMutation
}

function useEnableMutationForTest() {
  return useEnableAutoSign() as unknown as EnableMutation
}

describe("useEnableAutoSign random signer recovery", () => {
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
          typeUrl: "/cosmos.authz.v1beta1.MsgGrant",
          value: expect.objectContaining({ grantee: "init1newrandom" }),
        }),
      ]),
    )
    expect(mocks.activateWallet).toHaveBeenCalledWith("initiation-2")
    expect(mocks.requestTxBlock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.activateWallet.mock.invocationCallOrder[0]!,
    )
    expect(mocks.discardPendingIdentity).not.toHaveBeenCalled()
  })

  it("also revokes forgotten local grantees during renewal", async () => {
    mocks.getWalletIdentities.mockResolvedValue([
      { address: "init1oldrandom", provenance: "random", state: "active" },
      { address: "init1forgottenrandom", provenance: "random", state: "forgotten" },
    ])
    mocks.requestTxBlock.mockResolvedValue({ code: 0, rawLog: "" })

    await useRenewMutationForTest().mutationFn(input)

    const request = mocks.requestTxBlock.mock.calls[0]![0] as {
      messages: Array<{ typeUrl: string; value: { grantee?: string } }>
    }
    expect(request.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          typeUrl: "/cosmos.authz.v1beta1.MsgRevoke",
          value: expect.objectContaining({ grantee: "init1forgottenrandom" }),
        }),
      ]),
    )
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
    mocks.requestTxBlock.mockResolvedValue({ code: 5, rawLog: "renewal failed" })

    await expect(useRenewMutationForTest().mutationFn(input)).rejects.toThrow("renewal failed")

    expect(mocks.fetchGrants).toHaveBeenCalledWith("initiation-2", "init1oldrandom")
    expect(mocks.requestTxBlock).toHaveBeenCalledOnce()
    expect(mocks.activateWallet).not.toHaveBeenCalled()
    expect(mocks.discardPendingIdentity).toHaveBeenCalledWith("initiation-2", "replacement-key")
    expect(mocks.setStayConnected).not.toHaveBeenCalled()
  })

  it("retains the pending key when the broadcast outcome is unknown", async () => {
    mocks.requestTxBlock.mockRejectedValue(new Error("confirmation timed out"))

    await expect(useRenewMutationForTest().mutationFn(input)).rejects.toThrow(
      "confirmation timed out",
    )

    expect(mocks.fetchGrants).toHaveBeenCalledWith("initiation-2", "init1oldrandom")
    expect(mocks.activateWallet).not.toHaveBeenCalled()
    expect(mocks.discardPendingIdentity).not.toHaveBeenCalled()
  })

  it("keeps tab-only renewal from replacing an unavailable random signer", async () => {
    await expect(
      useRenewMutationForTest().mutationFn({ ...input, stayConnected: false }),
    ).rejects.toThrow("Select Stay connected to replace it")

    expect(mocks.createWallet).not.toHaveBeenCalled()
    expect(mocks.requestTxBlock).not.toHaveBeenCalled()
    expect(mocks.activateWallet).not.toHaveBeenCalled()
  })
})
