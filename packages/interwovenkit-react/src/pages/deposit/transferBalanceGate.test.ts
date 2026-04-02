import { getTransferBalanceBlocker } from "./transferBalanceGate"

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
