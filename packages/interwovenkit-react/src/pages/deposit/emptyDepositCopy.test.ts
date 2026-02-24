import { getEmptyDepositCopy } from "./emptyDepositCopy"

describe("getEmptyDepositCopy", () => {
  it("returns the generic copy for external + appchain support", () => {
    const copy = getEmptyDepositCopy({
      localSymbol: "ETH",
      externalSourceSymbol: "ETH",
      externalChainNames: ["Arbitrum", "Base", "Ethereum"],
      appchainSourceSymbols: ["ETH"],
    })

    expect(copy.title).toBe("No ETH available to deposit.")
    expect(copy.description).toBe(
      "You can deposit ETH from Arbitrum, Base, or Ethereum, or from any appchain.",
    )
  })

  it("returns the special iUSD copy for USDC external support", () => {
    const copy = getEmptyDepositCopy({
      localSymbol: "iUSD",
      externalSourceSymbol: "USDC",
      externalChainNames: ["Arbitrum", "Base", "Ethereum"],
      appchainSourceSymbols: ["USDC", "iUSD"],
    })

    expect(copy.title).toBe("No iUSD available to deposit.")
    expect(copy.description).toBe(
      "You can deposit iUSD using USDC from Arbitrum, Base, or Ethereum, or using USDC or iUSD from any appchain.",
    )
  })

  it("returns appchain-only copy when no external chains are supported", () => {
    const copy = getEmptyDepositCopy({
      localSymbol: "INIT",
      externalSourceSymbol: "INIT",
      externalChainNames: [],
      appchainSourceSymbols: ["INIT"],
    })

    expect(copy.title).toBe("No INIT available to deposit.")
    expect(copy.description).toBe("You can deposit INIT from any appchain.")
  })

  it("includes multiple appchain source symbols when available", () => {
    const copy = getEmptyDepositCopy({
      localSymbol: "iUSD",
      externalSourceSymbol: "USDC",
      externalChainNames: [],
      appchainSourceSymbols: ["iUSD", "USDC"],
    })

    expect(copy.description).toBe("You can deposit iUSD using USDC or iUSD from any appchain.")
  })

  it("formats two external chains with 'or'", () => {
    const copy = getEmptyDepositCopy({
      localSymbol: "ETH",
      externalSourceSymbol: "ETH",
      externalChainNames: ["Arbitrum", "Ethereum"],
      appchainSourceSymbols: [],
    })

    expect(copy.description).toBe("You can deposit ETH from Arbitrum or Ethereum.")
  })

  it("returns fallback copy when no sources are available", () => {
    const copy = getEmptyDepositCopy({
      localSymbol: "ETH",
      externalSourceSymbol: "ETH",
      externalChainNames: [],
      appchainSourceSymbols: [],
    })

    expect(copy.description).toBe("No deposit sources are currently available.")
  })
})
