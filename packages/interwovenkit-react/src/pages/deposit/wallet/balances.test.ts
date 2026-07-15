import { mapBalancesByChain } from "./balances"

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
