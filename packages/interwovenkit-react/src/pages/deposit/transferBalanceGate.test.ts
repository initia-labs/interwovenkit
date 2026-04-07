import {
  getResolvedTransferBalance,
  getTransferBalanceBlocker,
  hasSufficientTransferBalance,
} from "./transferBalanceGate"

describe("getTransferBalanceBlocker", () => {
  it("does not block when cached balances survive a refetch error", () => {
    expect(
      getTransferBalanceBlocker({
        hasBalancesSnapshot: true,
        hasBalanceQueryError: true,
        isBalancesLoading: false,
      }),
    ).toBeUndefined()
  })

  it("blocks with an error when balances never loaded", () => {
    expect(
      getTransferBalanceBlocker({
        hasBalancesSnapshot: false,
        hasBalanceQueryError: true,
        isBalancesLoading: false,
      }),
    ).toBe("error")
  })
})

describe("getResolvedTransferBalance", () => {
  it("treats a missing balance as zero after balances have loaded", () => {
    expect(
      getResolvedTransferBalance({
        hasBalancesSnapshot: true,
        balance: undefined,
      }),
    ).toBe("0")
  })

  it("keeps balance undefined while the first balance snapshot is still loading", () => {
    expect(
      getResolvedTransferBalance({
        hasBalancesSnapshot: false,
        balance: undefined,
      }),
    ).toBeUndefined()
  })
})

describe("hasSufficientTransferBalance", () => {
  it("treats a missing balance as zero when checking a positive spend amount", () => {
    expect(
      hasSufficientTransferBalance({
        balance: "0",
        requiredAmount: "1",
      }),
    ).toBe(false)
  })

  it("accepts a zero spend amount", () => {
    expect(
      hasSufficientTransferBalance({
        balance: "0",
        requiredAmount: "0",
      }),
    ).toBe(true)
  })
})
