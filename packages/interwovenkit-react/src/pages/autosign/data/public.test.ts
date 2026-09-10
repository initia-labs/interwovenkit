import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest"
import type { useInterwovenKit } from "@/public/data/hooks"
import { useAutoSign } from "./public"
import { type AutoSignStatusResult, useAutoSignStatus } from "./validation"

const mocks = vi.hoisted(() => ({ openDrawer: vi.fn(), setPendingRequest: vi.fn() }))

vi.mock("jotai", () => ({ useSetAtom: () => mocks.setPendingRequest }))
vi.mock("@/data/config", () => ({ useConfig: () => ({ defaultChainId: "test-chain" }) }))
vi.mock("@/data/ui", () => ({ useDrawer: () => ({ openDrawer: mocks.openDrawer }) }))
vi.mock("@/public/data/hooks", () => ({ useInitiaAddress: () => "init1owner" }))
vi.mock("./actions", () => ({ useDisableAutoSign: () => ({ mutateAsync: vi.fn() }) }))
vi.mock("./store", () => ({ pendingAutoSignRequestAtom: {} }))
vi.mock("./validation", () => ({ useAutoSignStatus: vi.fn() }))

beforeEach(() => vi.clearAllMocks())

describe("public autosign status", () => {
  it("passes an explicit app-owned connection preference to the approval request", () => {
    vi.mocked(useAutoSignStatus).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as ReturnType<typeof useAutoSignStatus>)

    void useAutoSign().enable("initiation-2", { stayConnected: false })

    expect(mocks.setPendingRequest).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: "initiation-2", stayConnected: false }),
    )
    expect(mocks.openDrawer).toHaveBeenCalledWith("/autosign/enable")
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
