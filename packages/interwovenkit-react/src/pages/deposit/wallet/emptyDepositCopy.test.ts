import { getEmptyDepositCopy } from "./emptyDepositCopy"

describe("getEmptyDepositCopy", () => {
  it("returns the generic copy for external + appchain support", () => {
    const copy = getEmptyDepositCopy({
      localSymbol: "ETH",
      externalSourceSymbols: ["ETH"],
      externalChainNames: ["Arbitrum", "Base", "Ethereum"],
      appchainSourceSymbols: ["ETH"],
    })

    expect(copy.title).toBe("No ETH available to deposit.")
    expect(copy.description).toBe(
      "You can deposit ETH from Arbitrum, Base, or Ethereum, or from any app.",
    )
  })

  it("returns the special iUSD copy for USDC and AUSD external support", () => {
    const copy = getEmptyDepositCopy({
      localSymbol: "iUSD",
      externalSourceSymbols: ["USDC", "AUSD"],
      externalChainNames: ["Ethereum"],
      appchainSourceSymbols: ["USDC", "iUSD"],
    })

    expect(copy.title).toBe("No iUSD available to deposit.")
    expect(copy.description).toBe(
      "You can deposit iUSD using USDC or AUSD from Ethereum, or using USDC or iUSD from any app.",
    )
  })

  it("returns appchain-only copy when no external chains are supported", () => {
    const copy = getEmptyDepositCopy({
      localSymbol: "INIT",
      externalSourceSymbols: ["INIT"],
      externalChainNames: [],
      appchainSourceSymbols: ["INIT"],
    })

    expect(copy.title).toBe("No INIT available to deposit.")
    expect(copy.description).toBe("You can deposit INIT from any app.")
  })

  it("includes multiple appchain source symbols when available", () => {
    const copy = getEmptyDepositCopy({
      localSymbol: "iUSD",
      externalSourceSymbols: ["USDC"],
      externalChainNames: [],
      appchainSourceSymbols: ["iUSD", "USDC"],
    })

    expect(copy.description).toBe("You can deposit iUSD using USDC or iUSD from any app.")
  })

  it("formats two external chains with 'or'", () => {
    const copy = getEmptyDepositCopy({
      localSymbol: "ETH",
      externalSourceSymbols: ["ETH"],
      externalChainNames: ["Arbitrum", "Ethereum"],
      appchainSourceSymbols: [],
    })

    expect(copy.description).toBe("You can deposit ETH from Arbitrum or Ethereum.")
  })

  it("returns fallback copy when no sources are available", () => {
    const copy = getEmptyDepositCopy({
      localSymbol: "ETH",
      externalSourceSymbols: ["ETH"],
      externalChainNames: [],
      appchainSourceSymbols: [],
    })

    expect(copy.description).toBe("No deposit sources are currently available.")
  })
})
