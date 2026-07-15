import { describe, expect, it } from "vitest"
import {
  fallbackAssetSymbol,
  fallbackChainName,
  findDestinationNetwork,
  formatProcessingTime,
  formatSlippagePercent,
  formatSourceMin,
} from "./source"
import type { Asset } from "./types"

const route = (
  src_chain_id: string,
  src_denom: string,
  src_decimals: number,
  min_deposit_amount: string,
): Asset => ({
  src_chain_id,
  src_denom,
  src_decimals,
  min_deposit_amount,
  max_slippage_percent: "0.5",
  dst_symbol: "iUSD",
  dst_networks: [],
})

// Mirrors the Deposit API's live config/assets (Ethereum, chain id "1").
const ETH = route("1", "ethereum-native", 18, "5000000000000000000")
const USDC = route("1", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6, "10000000")

describe("fallbackAssetSymbol", () => {
  it("derives native symbols and shortens unknown addresses", () => {
    expect(fallbackAssetSymbol("ethereum-native")).toBe("ETHEREUM")
    expect(fallbackAssetSymbol("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678")
  })
})

describe("fallbackChainName", () => {
  it("title-cases the chain id", () => {
    expect(fallbackChainName("base")).toBe("Base")
  })
})

describe("formatSourceMin", () => {
  it("formats in token units for stablecoins too", () => {
    expect(formatSourceMin(USDC.min_deposit_amount, USDC.src_decimals, "USDC")).toBe("10 USDC")
  })

  it("shows the token amount and symbol", () => {
    expect(formatSourceMin(ETH.min_deposit_amount, ETH.src_decimals, "ETH")).toBe("5 ETH")
  })

  // The displayed minimum must never understate the bound: sending exactly a
  // truncated minimum would still end below_minimum (no refund), so capping the
  // decimals rounds up.
  it("rounds the capped decimals up so the shown minimum never understates the bound", () => {
    expect(formatSourceMin("1234567890123456789", 18, "ETH")).toBe("1.234568 ETH")
  })
})

describe("formatSlippagePercent", () => {
  it("appends % and normalizes zero", () => {
    expect(formatSlippagePercent("0.5")).toBe("0.5%")
    expect(formatSlippagePercent("0.0")).toBe("0%")
  })
})

describe("formatProcessingTime", () => {
  it("rounds up to whole minutes and floors at < 1 min", () => {
    expect(formatProcessingTime(30)).toBe("< 1 min")
    expect(formatProcessingTime(300)).toBe("~5 min")
    expect(formatProcessingTime(330)).toBe("~6 min")
  })
})

describe("findDestinationNetwork", () => {
  it("matches on chain id and denom", () => {
    const network = {
      chain_id: "interwoven-1",
      chain_name: "initia",
      denom: "move/6c69",
      decimals: 6,
      vm_type: "move" as const,
      processing_time_seconds: 300,
    }
    const withNetworks = { ...USDC, dst_networks: [network] }
    expect(findDestinationNetwork(withNetworks, "interwoven-1", "move/6c69")).toBe(network)
    expect(findDestinationNetwork(withNetworks, "interwoven-1", "missing")).toBeUndefined()
  })
})
