import { parseBridgeIntent } from "./parseBridgeIntent"

describe("parseBridgeIntent", () => {
  it("parses full intent with amount, src, and dst with on", () => {
    const result = parseBridgeIntent("100 USDC from Ethereum to iUSD on Cabal")
    expect(result).toEqual({
      amount: "100",
      src: { assetText: "USDC", chainText: "Ethereum" },
      dst: { assetText: "iUSD", chainText: "Cabal" },
    })
  })

  it("parses without amount", () => {
    const result = parseBridgeIntent("USDC from Ethereum to Initia")
    expect(result).toEqual({
      amount: undefined,
      src: { assetText: "USDC", chainText: "Ethereum" },
      dst: { assetText: "Initia" },
    })
  })

  it("parses asset only", () => {
    const result = parseBridgeIntent("USDC")
    expect(result).toEqual({
      amount: undefined,
      src: { assetText: "USDC" },
      dst: {},
    })
  })

  it("parses src asset and chain only", () => {
    const result = parseBridgeIntent("USDC from Ethereum")
    expect(result).toEqual({
      amount: undefined,
      src: { assetText: "USDC", chainText: "Ethereum" },
      dst: {},
    })
  })

  it("parses arrow syntax ->", () => {
    const result = parseBridgeIntent("ETH -> INIT")
    expect(result).toEqual({
      amount: undefined,
      src: { assetText: "ETH" },
      dst: { assetText: "INIT" },
    })
  })

  it("parses arrow syntax =>", () => {
    const result = parseBridgeIntent("ETH => INIT")
    expect(result).toEqual({
      amount: undefined,
      src: { assetText: "ETH" },
      dst: { assetText: "INIT" },
    })
  })

  it("parses unicode arrow →", () => {
    const result = parseBridgeIntent("ETH → INIT")
    expect(result).toEqual({
      amount: undefined,
      src: { assetText: "ETH" },
      dst: { assetText: "INIT" },
    })
  })

  it("parses to + on for dst asset and chain", () => {
    const result = parseBridgeIntent("USDC from Ethereum to iUSD on Cabal")
    expect(result.dst).toEqual({ assetText: "iUSD", chainText: "Cabal" })
  })

  it("parses to without on as ambiguous dst", () => {
    const result = parseBridgeIntent("USDC from Ethereum to Initia")
    expect(result.dst).toEqual({ assetText: "Initia" })
  })

  it("strips commas from amount", () => {
    const result = parseBridgeIntent("1,000.5 USDC from Ethereum to Initia")
    expect(result.amount).toBe("1000.5")
  })

  it("handles decimal amount", () => {
    const result = parseBridgeIntent("0.5 ETH from Ethereum to Initia")
    expect(result.amount).toBe("0.5")
  })

  it("handles extra whitespace", () => {
    const result = parseBridgeIntent("  100   USDC   from   Ethereum   to   Initia  ")
    expect(result).toEqual({
      amount: "100",
      src: { assetText: "USDC", chainText: "Ethereum" },
      dst: { assetText: "Initia" },
    })
  })

  it("returns empty slots for empty input", () => {
    const result = parseBridgeIntent("")
    expect(result).toEqual({ amount: undefined, src: {}, dst: {} })
  })

  it("parses amount with asset and arrow to dst", () => {
    const result = parseBridgeIntent("50 ETH -> INIT")
    expect(result).toEqual({
      amount: "50",
      src: { assetText: "ETH" },
      dst: { assetText: "INIT" },
    })
  })

  it("parses multi-word chain names after from", () => {
    const result = parseBridgeIntent("USDC from Arbitrum One to Initia")
    expect(result.src.chainText).toBe("Arbitrum One")
  })

  it("parses 'on' before 'to' as src chain", () => {
    const result = parseBridgeIntent("USDC on Ethereum to Initia")
    expect(result).toEqual({
      amount: undefined,
      src: { assetText: "USDC", chainText: "Ethereum" },
      dst: { assetText: "Initia" },
    })
  })
})
