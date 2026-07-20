import { findBalanceByDenom, mapBalancesByChain } from "./balances"

describe("mapBalancesByChain", () => {
  it("backfills missing chain entries with empty balance maps", () => {
    expect(
      mapBalancesByChain({
        chainIds: ["interwoven-1", "echelon-1"],
        chains: {
          "interwoven-1": {
            denoms: {
              uinit: {
                amount: "10",
                decimals: 6,
                price: "1",
                formatted_amount: "0.000010",
                value_usd: "0.00001",
              },
            },
          },
        },
      }),
    ).toEqual({
      "interwoven-1": {
        uinit: {
          amount: "10",
          decimals: 6,
          price: "1",
          formatted_amount: "0.000010",
          value_usd: "0.00001",
        },
      },
      "echelon-1": {},
    })
  })
})

describe("findBalanceByDenom", () => {
  const evmBalance = {
    amount: "5",
    decimals: 18,
    price: "1",
    formatted_amount: "0.000000000000000005",
    value_usd: "0",
  }
  const cosmosBalance = {
    amount: "10",
    decimals: 6,
    price: "1",
    formatted_amount: "0.000010",
    value_usd: "0.00001",
  }
  const denomBalances = {
    "0xAbCd000000000000000000000000000000000000": evmBalance,
    uinit: cosmosBalance,
  }

  it("returns the exact-key match", () => {
    expect(
      findBalanceByDenom(denomBalances, "0xAbCd000000000000000000000000000000000000"),
    ).toEqual(evmBalance)
    expect(findBalanceByDenom(denomBalances, "uinit")).toEqual(cosmosBalance)
  })

  it("falls back to case-insensitive matching for EVM denoms", () => {
    expect(
      findBalanceByDenom(denomBalances, "0xABCD000000000000000000000000000000000000"),
    ).toEqual(evmBalance)
  })

  it("does not case-fold non-EVM denoms", () => {
    expect(findBalanceByDenom(denomBalances, "UINIT")).toBeUndefined()
  })

  it("returns undefined when the denom is absent", () => {
    expect(
      findBalanceByDenom(denomBalances, "0x0000000000000000000000000000000000000000"),
    ).toBeUndefined()
  })

  it("returns undefined without balances", () => {
    expect(findBalanceByDenom(undefined, "uinit")).toBeUndefined()
  })
})
