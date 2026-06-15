import { describe, expect, it } from "vitest"
import { isExcludedWallet } from "./walletExclusions"

describe("isExcludedWallet", () => {
  it("excludes Leap by id and normalized name", () => {
    expect(isExcludedWallet({ id: "io.leapwallet", name: "Something Else" })).toBe(true)
    expect(isExcludedWallet({ id: "wallet.custom", name: "Leap Wallet" })).toBe(true)
  })

  it("allows unrelated wallets", () => {
    expect(isExcludedWallet({ id: "app.keplr", name: "Keplr" })).toBe(false)
    expect(isExcludedWallet({ id: "wallet.compass", name: "Compass Wallet" })).toBe(false)
  })
})
