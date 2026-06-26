import { type SendBalanceSortItem, sortSendBalanceItems } from "./account"

function createItem(overrides: Partial<SendBalanceSortItem> & Pick<SendBalanceSortItem, "symbol">) {
  return {
    denom: overrides.symbol.toLowerCase(),
    balance: "1000000",
    value: 10,
    ...overrides,
  }
}

describe("sortSendBalanceItems", () => {
  const sorters = {
    isFeeToken: () => false,
    isListed: () => true,
  }

  it("should keep iUSD right after INIT regardless of value", () => {
    const items = [
      createItem({ symbol: "USDC", denom: "uusdc", value: 100 }),
      createItem({ symbol: "iUSD", denom: "iusd", value: 5 }),
      createItem({ symbol: "INIT", denom: "uinit", value: 1 }),
      createItem({ symbol: "ETH", denom: "ueth", value: 50 }),
    ]

    const sorted = sortSendBalanceItems(items, sorters)

    expect(sorted.map(({ symbol }) => symbol)).toEqual(["INIT", "iUSD", "USDC", "ETH"])
  })

  it("should still prioritize fee tokens after pinned assets", () => {
    const items = [
      createItem({ symbol: "ETH", denom: "ueth", value: 100 }),
      createItem({ symbol: "USDC", denom: "uusdc", value: 1 }),
      createItem({ symbol: "INIT", denom: "uinit", value: 50 }),
      createItem({ symbol: "iUSD", denom: "iusd", value: 50 }),
    ]

    const sorted = sortSendBalanceItems(items, {
      isFeeToken: (denom) => denom === "uusdc",
      isListed: () => true,
    })

    // USDC (fee token, value 1) must beat ETH (non-fee, value 100) despite the lower value
    expect(sorted.map(({ symbol }) => symbol)).toEqual(["INIT", "iUSD", "USDC", "ETH"])
  })

  it("should prioritize listed assets when higher-priority fields tie", () => {
    const items = [
      createItem({ symbol: "ALPHA", denom: "uunlisted", value: 10 }),
      createItem({ symbol: "ZETA", denom: "ulisted", value: 10 }),
    ]

    const sorted = sortSendBalanceItems(items, {
      isFeeToken: () => false,
      isListed: (denom) => denom === "ulisted",
    })

    expect(sorted.map(({ symbol }) => symbol)).toEqual(["ZETA", "ALPHA"])
  })

  it("should sort by balance when higher-priority fields tie", () => {
    const items = [
      createItem({ symbol: "ALPHA", denom: "ualpha", balance: "1000", value: 10 }),
      createItem({ symbol: "ZETA", denom: "uzeta", balance: "2000", value: 10 }),
    ]

    const sorted = sortSendBalanceItems(items, sorters)

    expect(sorted.map(({ symbol }) => symbol)).toEqual(["ZETA", "ALPHA"])
  })

  it("should treat empty balances as zero", () => {
    const items = [
      createItem({ symbol: "EMPTY", denom: "uempty", balance: "", value: 10 }),
      createItem({ symbol: "FUNDED", denom: "ufunded", balance: "1", value: 10 }),
    ]

    const sorted = sortSendBalanceItems(items, sorters)

    expect(sorted.map(({ symbol }) => symbol)).toEqual(["FUNDED", "EMPTY"])
  })

  it("should sort alphabetically by symbol when higher-priority fields tie", () => {
    const items = [
      createItem({ symbol: "ctoken" }),
      createItem({ symbol: "Btoken" }),
      createItem({ symbol: "aToken" }),
    ]

    const sorted = sortSendBalanceItems(items, sorters)

    expect(sorted.map(({ symbol }) => symbol)).toEqual(["aToken", "Btoken", "ctoken"])
  })
})
