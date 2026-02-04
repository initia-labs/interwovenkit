import type { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin"
import { describe, expect, it } from "vitest"
import { buildAutoSignFeeFromSimulation, selectAutoSignGasPrice } from "./tx"

const gasPrices: Coin[] = [
  { denom: "uinit", amount: "0.010000000000000000" },
  { denom: "uusdc", amount: "0.020000000000000000" },
]

describe("selectAutoSignGasPrice", () => {
  it("uses preferred denom when available", () => {
    const selected = selectAutoSignGasPrice({
      gasPrices,
      preferredFeeDenom: "uusdc",
    })

    expect(selected.denom).toBe("uusdc")
  })

  it("uses fallback denom when preferred denom is unavailable", () => {
    const selected = selectAutoSignGasPrice({
      gasPrices,
      preferredFeeDenom: "uatom",
      fallbackFeeDenom: "uinit",
    })

    expect(selected.denom).toBe("uinit")
  })

  it("filters denoms by policy allowlist", () => {
    const selected = selectAutoSignGasPrice({
      gasPrices,
      allowedFeeDenoms: ["uusdc"],
    })

    expect(selected.denom).toBe("uusdc")
  })

  it("throws when policy filters out all denoms", () => {
    expect(() =>
      selectAutoSignGasPrice({
        gasPrices,
        allowedFeeDenoms: ["uatom"],
      }),
    ).toThrow("No allowed gas price tokens available for auto-sign")
  })
})

describe("buildAutoSignFeeFromSimulation", () => {
  it("builds a fee using simulated gas and selected denom", () => {
    const fee = buildAutoSignFeeFromSimulation({
      simulatedGas: 100,
      gasPrices,
      preferredFeeDenom: "uusdc",
      policy: {
        gasMultiplier: 1.2,
        maxGasMultiplierFromSim: 1.5,
      },
    })

    expect(fee.gas).toBe("120")
    expect(fee.amount[0]?.denom).toBe("uusdc")
  })

  it("throws when simulated gas is invalid", () => {
    expect(() =>
      buildAutoSignFeeFromSimulation({
        simulatedGas: 0,
        gasPrices,
        policy: {
          gasMultiplier: 1.2,
          maxGasMultiplierFromSim: 1.5,
        },
      }),
    ).toThrow("Auto-sign gas simulation failed")
  })

  it("throws when gas multiplier policy is invalid", () => {
    expect(() =>
      buildAutoSignFeeFromSimulation({
        simulatedGas: 100,
        gasPrices,
        policy: {
          gasMultiplier: 1.6,
          maxGasMultiplierFromSim: 1.5,
        },
      }),
    ).toThrow("Invalid auto-sign gas multiplier policy")
  })
})
