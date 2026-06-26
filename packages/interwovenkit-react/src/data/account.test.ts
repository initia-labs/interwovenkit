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
      createItem({ symbol: "USDC", denom: "uusdc", value: 1 }),
      createItem({ symbol: "INIT", denom: "uinit", value: 100 }),
      createItem({ symbol: "iUSD", denom: "iusd", value: 50 }),
    ]

    const sorted = sortSendBalanceItems(items, {
      isFeeToken: (denom) => denom === "uusdc",
      isListed: () => true,
    })

    expect(sorted.map(({ symbol }) => symbol)).toEqual(["INIT", "iUSD", "USDC"])
  })

  it("should sort alphabetically by symbol when higher-priority fields tie", () => {
    const items = [
      createItem({ symbol: "USDC", denom: "uusdc" }),
      createItem({ symbol: "ETH", denom: "ueth" }),
      createItem({ symbol: "ATOM", denom: "uatom" }),
    ]

    const sorted = sortSendBalanceItems(items, sorters)

    expect(sorted.map(({ symbol }) => symbol)).toEqual(["ATOM", "ETH", "USDC"])
  })
})
