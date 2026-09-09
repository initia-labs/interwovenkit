import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { activeWalletOwnerAtom, pendingAutoSignRequestAtom, walletGenerationAtom } from "./store"

const mocks = vi.hoisted(() => ({
  activateWallet: vi.fn(),
  clearExpectedAddress: vi.fn(),
  createWallet: vi.fn(),
  discardPendingIdentity: vi.fn(),
  fetchFeegrant: vi.fn(),
  fetchGrants: vi.fn(),
  getStayConnected: vi.fn(),
  getWalletIdentities: vi.fn(),
  getWalletProvenance: vi.fn(),
  getWalletRevision: vi.fn(),
  invalidateQueries: vi.fn().mockResolvedValue(undefined),
  pendingRequest: {
    chainId: "initiation-2",
    owner: "init1owner",
    resolve: vi.fn(),
    reject: vi.fn(),
  },
  restoreWallet: vi.fn(),
  setPendingRequest: vi.fn(),
  setStayConnected: vi.fn(),
  storeExpectedAddress: vi.fn(),
  updateWalletObservation: vi.fn(),
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

vi.mock("@/data/signer", () => ({
  clearSigningClientCache: vi.fn(),
}))

vi.mock("@/data/tx", () => ({
  useTx: () => ({ requestTxBlock: vi.fn() }),
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

vi.mock("./wallet", () => ({
  clearExpectedAddress: mocks.clearExpectedAddress,
  getExpectedAddress: vi.fn(),
  storeExpectedAddress: mocks.storeExpectedAddress,
  useDeriveWallet: () => ({
    activateWallet: mocks.activateWallet,
    createWallet: mocks.createWallet,
    discardPendingIdentity: mocks.discardPendingIdentity,
    deriveWallet: vi.fn(),
    getStayConnected: mocks.getStayConnected,
    getWalletIdentities: mocks.getWalletIdentities,
    getWalletProvenance: mocks.getWalletProvenance,
    getWalletRevision: mocks.getWalletRevision,
    restoreWallet: mocks.restoreWallet,
    setStayConnected: mocks.setStayConnected,
    updateWalletObservation: mocks.updateWalletObservation,
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

import { useEnableAutoSign } from "./actions"

interface EnableMutation {
  onSuccess: (result: {
    chainId: string
    derivedWallet: { address: string }
    owner: string
    ownerGeneration: number
    expectedGrantee?: string | null
    request: typeof mocks.pendingRequest
    legacyExpectedAddressAction?: "store" | "clear"
  }) => Promise<unknown>
}

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
})

function useEnableMutationForTest() {
  return useEnableAutoSign() as unknown as EnableMutation
}

describe("useEnableAutoSign legacy mirror cleanup", () => {
  it("clears the exact stored legacy mirror after a random grant succeeds", async () => {
    await useEnableMutationForTest().onSuccess({
      chainId: "initiation-2",
      derivedWallet: { address: "init1newrandom" },
      owner: "init1owner",
      ownerGeneration: 7,
      expectedGrantee: "init1legacyderived",
      request: mocks.pendingRequest,
      legacyExpectedAddressAction: "clear",
    })

    expect(mocks.clearExpectedAddress).toHaveBeenCalledWith(
      "init1owner",
      "initiation-2",
      "init1legacyderived",
    )
    expect(mocks.storeExpectedAddress).not.toHaveBeenCalled()
    expect(mocks.pendingRequest.resolve).toHaveBeenCalledOnce()
  })
})
