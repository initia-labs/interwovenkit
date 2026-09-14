import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest"
import type { useInterwovenKit } from "@/public/data/hooks"
import { useAutoSign } from "./public"
import { AutoSignCancelledError } from "./storage"
import { type PendingAutoSignRequest, pendingAutoSignRequestAtom } from "./store"
import { type AutoSignStatusResult, useAutoSignStatus } from "./validation"

const mocks = vi.hoisted(() => ({
  openDrawer: vi.fn(),
  pendingRequest: null as PendingAutoSignRequest | null,
  store: {
    get: vi.fn(),
    set: vi.fn(),
  },
}))

vi.mock("jotai", () => ({
  atom: vi.fn(() => ({})),
  useStore: () => mocks.store,
}))
vi.mock("@/data/config", () => ({ useConfig: () => ({ defaultChainId: "test-chain" }) }))
vi.mock("@/data/ui", () => ({ useDrawer: () => ({ openDrawer: mocks.openDrawer }) }))
vi.mock("@/public/data/hooks", () => ({ useInitiaAddress: () => "init1owner" }))
vi.mock("./actions", () => ({ useDisableAutoSign: () => ({ mutateAsync: vi.fn() }) }))
vi.mock("./validation", () => ({ useAutoSignStatus: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.pendingRequest = null
  mocks.store.get.mockImplementation((atom) =>
    atom === pendingAutoSignRequestAtom ? mocks.pendingRequest : undefined,
  )
  mocks.store.set.mockImplementation((atom, value) => {
    if (atom === pendingAutoSignRequestAtom) mocks.pendingRequest = value
  })
})

describe("public autosign status", () => {
  it("passes an explicit app-owned connection preference to the approval request", () => {
    vi.mocked(useAutoSignStatus).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as ReturnType<typeof useAutoSignStatus>)

    void useAutoSign().enable("initiation-2", { stayConnected: false })

    expect(mocks.pendingRequest).toEqual(
      expect.objectContaining({ chainId: "initiation-2", stayConnected: false }),
    )
    expect(mocks.openDrawer).toHaveBeenCalledWith("/autosign/enable")
  })

  it("rejects a concurrent enable without replacing or settling the accepted request", async () => {
    vi.mocked(useAutoSignStatus).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as ReturnType<typeof useAutoSignStatus>)
    const autoSign = useAutoSign()
    const first = autoSign.enable("initiation-2")
    const accepted = mocks.pendingRequest

    await expect(autoSign.enable("initiation-3")).rejects.toBeInstanceOf(AutoSignCancelledError)
    expect(mocks.pendingRequest).toBe(accepted)

    accepted?.resolve()
    accepted?.reject(new Error("late rejection"))
    await expect(first).resolves.toBeUndefined()
  })

  it("clears and rejects the accepted request when opening the approval UI fails", async () => {
    vi.mocked(useAutoSignStatus).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as ReturnType<typeof useAutoSignStatus>)
    const drawerError = new Error("drawer unavailable")
    mocks.openDrawer.mockImplementationOnce(() => {
      throw drawerError
    })

    await expect(useAutoSign().enable("initiation-2")).rejects.toBe(drawerError)
    expect(mocks.pendingRequest).toBeNull()
  })

  it.each([true, false])(
    "keeps status maps usable without query data (loading=%s)",
    (isLoading) => {
      vi.mocked(useAutoSignStatus).mockReturnValue({ data: undefined, isLoading } as ReturnType<
        typeof useAutoSignStatus
      >)

      const autoSign = useAutoSign()
      expect(autoSign.statusByChain["test-chain"]).toBeUndefined()
      expect(autoSign.feegrantByChain["test-chain"]).toBeUndefined()
      expect(autoSign.isLoading).toBe(isLoading)
      expectTypeOf<
        ReturnType<typeof useInterwovenKit>["autoSign"]
      >().toExtend<AutoSignStatusResult>()
    },
  )

  it("keeps empty map references stable across renders", () => {
    vi.mocked(useAutoSignStatus).mockReturnValue({ data: undefined, isLoading: true } as ReturnType<
      typeof useAutoSignStatus
    >)
    const first = useAutoSign()
    const next = useAutoSign()
    expect(next.statusByChain).toBe(first.statusByChain)
    expect(next.feegrantByChain).toBe(first.feegrantByChain)
  })
})
