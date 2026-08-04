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
  it("returns the provided balance once balances have loaded", () => {
    expect(
      getResolvedTransferBalance({
        hasBalancesSnapshot: true,
        balance: "123",
      }),
    ).toBe("123")
  })

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
  it("returns true when the balance covers the required amount", () => {
    expect(
      hasSufficientTransferBalance({
        balance: "2",
        requiredAmount: "1",
      }),
    ).toBe(true)
  })

  it("returns true when balance exactly equals required amount", () => {
    expect(
      hasSufficientTransferBalance({
        balance: "100",
        requiredAmount: "100",
      }),
    ).toBe(true)
  })

  it("treats a missing balance as zero when checking a positive spend amount", () => {
    expect(
      hasSufficientTransferBalance({
        balance: undefined,
        requiredAmount: "1",
      }),
    ).toBe(false)
  })

  it("returns false when a zero balance cannot cover a positive spend amount", () => {
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

  it("returns false for invalid numeric inputs", () => {
    expect(
      hasSufficientTransferBalance({
        balance: "",
        requiredAmount: "1",
      }),
    ).toBe(false)
    expect(
      hasSufficientTransferBalance({
        balance: "1",
        requiredAmount: "-1",
      }),
    ).toBe(false)
  })
})
