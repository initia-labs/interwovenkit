import type { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin"
import { describe, expect, it, vi } from "vitest"
import {
  buildAutoSignFeeFromSimulation,
  buildAutoSignSimulationInput,
  selectAutoSignGasPrice,
} from "./tx"

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

describe("buildAutoSignSimulationInput", () => {
  it("uses derived wallet address and wraps messages in MsgExec", () => {
    const sourceMessages = [
      { typeUrl: "/initia.move.v1.MsgExecute", value: { moduleAddress: "0x1" } },
      { typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: { fromAddress: "a", toAddress: "b" } },
    ]

    const encodedMessageA = new Uint8Array([1, 2, 3])
    const encodedMessageB = new Uint8Array([4, 5, 6])

    const encode = vi.fn().mockReturnValueOnce(encodedMessageA).mockReturnValueOnce(encodedMessageB)

    const simulation = buildAutoSignSimulationInput({
      derivedAddress: "init1derivedwallet",
      messages: sourceMessages,
      encoder: { encode },
    })

    expect(simulation.messages).toHaveLength(1)
    expect(simulation.messages[0]?.typeUrl).toBe("/cosmos.authz.v1beta1.MsgExec")

    const msgExec = simulation.messages[0]?.value as {
      grantee?: string
      msgs?: Array<{ typeUrl: string; value: Uint8Array }>
    }
    expect(msgExec.grantee).toBe("init1derivedwallet")
    expect(msgExec.msgs?.map((msg) => msg.typeUrl)).toEqual([
      "/initia.move.v1.MsgExecute",
      "/cosmos.bank.v1beta1.MsgSend",
    ])
    expect(msgExec.msgs?.[0]?.value).toEqual(encodedMessageA)
    expect(msgExec.msgs?.[1]?.value).toEqual(encodedMessageB)
    expect(encode).toHaveBeenCalledTimes(2)
  })
})
