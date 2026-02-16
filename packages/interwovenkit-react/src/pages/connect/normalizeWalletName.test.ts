import { describe, expect, it } from "vitest"
import { normalizeWalletName } from "./normalizeWalletName"

describe("normalizeWalletName", () => {
  it("removes supported suffixes only when separated by whitespace", () => {
    expect(normalizeWalletName("Leap Wallet")).toBe("leap")
    expect(normalizeWalletName("Rainbow Extension")).toBe("rainbow")
    expect(normalizeWalletName("Some App")).toBe("some")
  })

  it("keeps compound words that end with those terms", () => {
    expect(normalizeWalletName("TrustWallet")).toBe("trustwallet")
    expect(normalizeWalletName("DApp")).toBe("dapp")
  })

  it("handles trailing spaces before normalization", () => {
    expect(normalizeWalletName("Leap Wallet   ")).toBe("leap")
  })
})
