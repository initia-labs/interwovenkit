import { beforeEach, describe, expect, it, vi } from "vitest"
import type * as InitiaUtils from "@initia/utils"
import { createMoveClient } from "@initia/utils"
import type { NormalizedChain, PriceItem } from "./chains"
import type { Config } from "./config"
import { fetchStratSupplementalPrices, parseXslpPriceInCollateral } from "./strat"

vi.mock("@initia/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof InitiaUtils>()
  return { ...actual, createMoveClient: vi.fn() }
})

describe("parseXslpPriceInCollateral", () => {
  it("parses a decimal string view result (BigDecimal serialization)", () => {
    expect(parseXslpPriceInCollateral("0.99424041")).toBeCloseTo(0.99424041)
  })

  it("parses a whole-number decimal string without scaling it as base units", () => {
    // get_strat_share_to_xslp_ratio returned "1" on-chain — must stay 1, not 0.000001.
    expect(parseXslpPriceInCollateral("1")).toBe(1)
  })

  it("parses a one-item array view result", () => {
    expect(parseXslpPriceInCollateral(["2.5"])).toBe(2.5)
  })

  it("returns undefined for invalid or non-positive values", () => {
    expect(parseXslpPriceInCollateral("")).toBeUndefined()
    expect(parseXslpPriceInCollateral("0")).toBeUndefined()
    expect(parseXslpPriceInCollateral({ value: "1000000" })).toBeUndefined()
  })
})

describe("fetchStratSupplementalPrices", () => {
  const stratChain = {
    chain_name: "strat",
    restUrl: "https://rest.strat.example.com",
  } as NormalizedChain
  const config: Config = {
    stratLpModuleAddress: "0x9a838c8d805e885481f594efee110d6f5b407d530866f4973955afae88941733",
    stratXslpCollateralMetadata:
      "0x13bab7c0ed9dd9f4609f7dee7a5f69c99e14eca507f77e088d9b429f77e47b81",
  } as Config

  const xslpDenom = "move/4e11c0a219f362e4d0e1f131699aa83bee40ebc8701b424373a8517d0c9e85fb"
  const basePrices: PriceItem[] = [
    { id: "ibc/init", symbol: "INIT", price: 0.05 },
    { id: "ibc/iusd", symbol: "iUSD", price: 0.999484 },
    { id: xslpDenom, symbol: "xSLP", price: 0 },
  ]

  beforeEach(() => {
    vi.mocked(createMoveClient).mockReset()
  })

  it("returns [] for non-Strat chains without calling the Move client", async () => {
    const otherChain = {
      chain_name: "initia",
      restUrl: "https://rest.example.com",
    } as NormalizedChain
    const result = await fetchStratSupplementalPrices(otherChain, basePrices, config)

    expect(result).toEqual([])
    expect(createMoveClient).not.toHaveBeenCalled()
  })

  it("returns [] when the Strat addresses aren't configured for this network", async () => {
    const result = await fetchStratSupplementalPrices(stratChain, basePrices, {} as Config)

    expect(result).toEqual([])
    expect(createMoveClient).not.toHaveBeenCalled()
  })

  it("returns [] when the indexer doesn't list an xSLP asset at all", async () => {
    const pricesWithoutXslp = basePrices.filter((price) => price.symbol !== "xSLP")
    const result = await fetchStratSupplementalPrices(stratChain, pricesWithoutXslp, config)

    expect(result).toEqual([])
    expect(createMoveClient).not.toHaveBeenCalled()
  })

  it("returns [] when the indexer already has a positive xSLP price (nothing to supplement)", async () => {
    const pricesWithXslpPriced = basePrices.map((price) =>
      price.symbol === "xSLP" ? { ...price, price: 1.5 } : price,
    )
    const result = await fetchStratSupplementalPrices(stratChain, pricesWithXslpPriced, config)

    expect(result).toEqual([])
    expect(createMoveClient).not.toHaveBeenCalled()
  })

  it("prices xSLP under its real indexer denom, converted to USD via iUSD's own price", async () => {
    const viewFunction = vi.fn().mockResolvedValue("0.99424041")
    vi.mocked(createMoveClient).mockReturnValue({ viewFunction })

    const result = await fetchStratSupplementalPrices(stratChain, basePrices, config)

    // 0.99424041 (xSLP-in-iUSD) * 0.999484 (iUSD-in-USD), not assumed 1:1.
    expect(result).toEqual([{ id: xslpDenom, price: 0.99424041 * 0.999484 }])
    expect(viewFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        moduleAddress: config.stratLpModuleAddress,
        moduleName: "lp",
        functionName: "get_xslp_price_in_collateral",
        typeArgs: [],
      }),
    )
    // The view function requires the collateral metadata as an argument — omitting it fails
    // on-chain with INVALID_MAIN_FUNCTION_SIGNATURE (confirmed against strat-1 mainnet).
    expect(viewFunction.mock.calls[0][0].args).toHaveLength(1)
  })

  it("falls back to a 1:1 collateral-to-USD rate when iUSD itself isn't in the indexer list", async () => {
    const viewFunction = vi.fn().mockResolvedValue("0.99424041")
    vi.mocked(createMoveClient).mockReturnValue({ viewFunction })
    const pricesWithoutIusd = basePrices.filter((price) => price.symbol !== "iUSD")

    const result = await fetchStratSupplementalPrices(stratChain, pricesWithoutIusd, config)

    expect(result).toEqual([{ id: xslpDenom, price: 0.99424041 }])
  })

  it("falls back to a 1:1 rate when iUSD is present but itself unpriced (price: 0)", async () => {
    const viewFunction = vi.fn().mockResolvedValue("0.99424041")
    vi.mocked(createMoveClient).mockReturnValue({ viewFunction })
    const pricesWithZeroIusd = basePrices.map((price) =>
      price.symbol === "iUSD" ? { ...price, price: 0 } : price,
    )

    const result = await fetchStratSupplementalPrices(stratChain, pricesWithZeroIusd, config)

    expect(result).toEqual([{ id: xslpDenom, price: 0.99424041 }])
  })

  it("matches xSLP/iUSD symbols case-insensitively", async () => {
    const viewFunction = vi.fn().mockResolvedValue("0.99424041")
    vi.mocked(createMoveClient).mockReturnValue({ viewFunction })
    const pricesWithDifferentCasing = basePrices.map((price) => ({
      ...price,
      symbol: price.symbol?.toLowerCase(),
    }))

    const result = await fetchStratSupplementalPrices(stratChain, pricesWithDifferentCasing, config)

    expect(result).toEqual([{ id: xslpDenom, price: 0.99424041 * 0.999484 }])
  })

  it("returns [] when the view call throws", async () => {
    const viewFunction = vi.fn().mockRejectedValue(new Error("VM error"))
    vi.mocked(createMoveClient).mockReturnValue({ viewFunction })

    const result = await fetchStratSupplementalPrices(stratChain, basePrices, config)

    expect(result).toEqual([])
  })

  it("returns [] when the view result parses to a non-positive price", async () => {
    const viewFunction = vi.fn().mockResolvedValue("0")
    vi.mocked(createMoveClient).mockReturnValue({ viewFunction })

    const result = await fetchStratSupplementalPrices(stratChain, basePrices, config)

    expect(result).toEqual([])
  })
})
