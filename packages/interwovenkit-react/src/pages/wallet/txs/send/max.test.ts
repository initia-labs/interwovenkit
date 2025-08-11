import { toBaseUnit } from "@initia/utils"
import { calcMaxAmount } from "./max"

describe("calcMaxAmount", () => {
  const gasPrices = [
    { denom: "INIT", amount: "0.015" },
    { denom: "USDC", amount: "0.03" },
  ]

  const gas = Math.floor(1e6 / 0.015)

  describe("Balance 0.01 INIT + 0.01 USDC", () => {
    const balances = [
      { denom: "INIT", amount: String(0.01 * 1e6) },
      { denom: "USDC", amount: String(0.01 * 1e6) },
    ]

    test.each`
      denom     | lastFeeDenom | expected
      ${"INIT"} | ${null}      | ${toBaseUnit("0.01", { decimals: 6 })}
      ${"INIT"} | ${"INIT"}    | ${toBaseUnit("0.01", { decimals: 6 })}
      ${"INIT"} | ${"USDC"}    | ${toBaseUnit("0.01", { decimals: 6 })}
      ${"USDC"} | ${null}      | ${toBaseUnit("0.01", { decimals: 6 })}
      ${"USDC"} | ${"INIT"}    | ${toBaseUnit("0.01", { decimals: 6 })}
      ${"USDC"} | ${"USDC"}    | ${toBaseUnit("0.01", { decimals: 6 })}
    `(
      "returns $expected when sending $denom with lastFeeDenom=$lastFeeDenom",
      ({ denom, lastFeeDenom, expected }) => {
        const result = calcMaxAmount({ denom, balances, gasPrices, lastFeeDenom, gas })
        expect(result).toBe(expected)
      },
    )
  })

  describe("Balance 0.01 INIT + 100 USDC", () => {
    const balances = [
      { denom: "INIT", amount: String(0.01 * 1e6) },
      { denom: "USDC", amount: String(100 * 1e6) },
    ]

    test.each`
      denom     | lastFeeDenom | expected
      ${"INIT"} | ${null}      | ${toBaseUnit("0.01", { decimals: 6 })}
      ${"INIT"} | ${"INIT"}    | ${toBaseUnit("0.01", { decimals: 6 })}
      ${"INIT"} | ${"USDC"}    | ${toBaseUnit("0.01", { decimals: 6 })}
      ${"USDC"} | ${null}      | ${toBaseUnit("98", { decimals: 6 })}
      ${"USDC"} | ${"INIT"}    | ${toBaseUnit("98", { decimals: 6 })}
      ${"USDC"} | ${"USDC"}    | ${toBaseUnit("98", { decimals: 6 })}
    `(
      "returns $expected when sending $denom with lastFeeDenom=$lastFeeDenom",
      ({ denom, lastFeeDenom, expected }) => {
        const result = calcMaxAmount({ denom, balances, gasPrices, lastFeeDenom, gas })
        expect(result).toBe(expected)
      },
    )
  })

  describe("Balance 100 INIT + 0.01 USDC", () => {
    const balances = [
      { denom: "INIT", amount: String(100 * 1e6) },
      { denom: "USDC", amount: String(0.01 * 1e6) },
    ]

    test.each`
      denom     | lastFeeDenom | expected
      ${"INIT"} | ${null}      | ${toBaseUnit("99", { decimals: 6 })}
      ${"INIT"} | ${"INIT"}    | ${toBaseUnit("99", { decimals: 6 })}
      ${"INIT"} | ${"USDC"}    | ${toBaseUnit("99", { decimals: 6 })}
      ${"USDC"} | ${null}      | ${toBaseUnit("0.01", { decimals: 6 })}
      ${"USDC"} | ${"INIT"}    | ${toBaseUnit("0.01", { decimals: 6 })}
      ${"USDC"} | ${"USDC"}    | ${toBaseUnit("0.01", { decimals: 6 })}
    `(
      "returns $expected when sending $denom with lastFeeDenom=$lastFeeDenom",
      ({ denom, lastFeeDenom, expected }) => {
        const result = calcMaxAmount({ denom, balances, gasPrices, lastFeeDenom, gas })
        expect(result).toBe(expected)
      },
    )
  })

  describe("Balance 100 INIT + 100 USDC", () => {
    const balances = [
      { denom: "INIT", amount: String(100 * 1e6) },
      { denom: "USDC", amount: String(100 * 1e6) },
    ]

    test.each`
      denom     | lastFeeDenom | expected
      ${"INIT"} | ${null}      | ${toBaseUnit("100", { decimals: 6 })}
      ${"INIT"} | ${"INIT"}    | ${toBaseUnit("99", { decimals: 6 })}
      ${"INIT"} | ${"USDC"}    | ${toBaseUnit("100", { decimals: 6 })}
      ${"USDC"} | ${null}      | ${toBaseUnit("100", { decimals: 6 })}
      ${"USDC"} | ${"INIT"}    | ${toBaseUnit("100", { decimals: 6 })}
      ${"USDC"} | ${"USDC"}    | ${toBaseUnit("98", { decimals: 6 })}
    `(
      "returns $expected when sending $denom with lastFeeDenom=$lastFeeDenom",
      ({ denom, lastFeeDenom, expected }) => {
        const result = calcMaxAmount({ denom, balances, gasPrices, lastFeeDenom, gas })
        expect(result).toBe(expected)
      },
    )
  })

  describe("Balance 100 INIT + 100 USDC + 100 ETH", () => {
    const balances = [
      { denom: "INIT", amount: String(100 * 1e6) },
      { denom: "USDC", amount: String(100 * 1e6) },
      { denom: "ETH", amount: String(100 * 1e6) },
    ]

    test.each`
      denom    | lastFeeDenom | expected
      ${"ETH"} | ${null}      | ${toBaseUnit("100", { decimals: 6 })}
      ${"ETH"} | ${"INIT"}    | ${toBaseUnit("100", { decimals: 6 })}
      ${"ETH"} | ${"USDC"}    | ${toBaseUnit("100", { decimals: 6 })}
    `(
      "returns $expected when sending $denom with lastFeeDenom=$lastFeeDenom",
      ({ denom, lastFeeDenom, expected }) => {
        const result = calcMaxAmount({ denom, balances, gasPrices, lastFeeDenom, gas })
        expect(result).toBe(expected)
      },
    )
  })
})
