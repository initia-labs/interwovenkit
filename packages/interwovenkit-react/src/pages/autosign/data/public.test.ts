import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest"
import type { useInterwovenKit } from "@/public/data/hooks"
import { useAutoSign } from "./public"
import { type AutoSignStatusResult, useAutoSignStatus } from "./validation"

vi.mock("jotai", () => ({ useSetAtom: () => vi.fn() }))
vi.mock("@/data/config", () => ({ useConfig: () => ({ defaultChainId: "test-chain" }) }))
vi.mock("@/data/ui", () => ({ useDrawer: () => ({ openDrawer: vi.fn() }) }))
vi.mock("@/public/data/hooks", () => ({ useInitiaAddress: () => "init1owner" }))
vi.mock("./actions", () => ({ useDisableAutoSign: () => ({ mutateAsync: vi.fn() }) }))
vi.mock("./store", () => ({ pendingAutoSignRequestAtom: {} }))
vi.mock("./validation", () => ({ useAutoSignStatus: vi.fn() }))

beforeEach(() => vi.clearAllMocks())

describe("public autosign status", () => {
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

  it("exposes loaded status through the same public maps", () => {
    const data: AutoSignStatusResult = {
      expiredAtByChain: { "test-chain": undefined },
      feegrantByChain: {},
      isEnabledByChain: { "test-chain": true },
      granteeByChain: { "test-chain": "init1grantee" },
      requestedDurationInMsByChain: { "test-chain": 0 },
      statusByChain: { "test-chain": "enabled" },
    }
    vi.mocked(useAutoSignStatus).mockReturnValue({ data, isLoading: false } as ReturnType<
      typeof useAutoSignStatus
    >)

    const autoSign = useAutoSign()
    expect(autoSign.statusByChain["test-chain"]).toBe("enabled")
    expect(autoSign.granteeByChain["test-chain"]).toBe("init1grantee")
    expect(autoSign.isEnabledByChain["test-chain"]).toBe(true)
  })
})
