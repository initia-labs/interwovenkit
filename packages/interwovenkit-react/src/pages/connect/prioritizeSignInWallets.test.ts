import { describe, expect, it } from "vitest"
import { prioritizeSignInWallets } from "./prioritizeSignInWallets"

interface WalletLike {
  id: string
  name: string
}

const POPULAR_WALLETS: WalletLike[] = [
  { id: "io.rabby", name: "Rabby" },
  { id: "app.phantom", name: "Phantom" },
  { id: "app.keplr", name: "Keplr" },
  { id: "io.leapwallet", name: "Leap" },
  { id: "io.metamask", name: "MetaMask" },
]

describe("prioritizeSignInWallets", () => {
  it("keeps original order when wallet count is within limit", () => {
    const readyWallets: WalletLike[] = [
      { id: "wallet.alpha", name: "Alpha" },
      { id: "wallet.beta", name: "Beta" },
      { id: "io.metamask", name: "MetaMask" },
    ]

    const result = prioritizeSignInWallets(readyWallets, POPULAR_WALLETS, 5)

    expect(result).toEqual(readyWallets)
  })

  it("prioritizes owned popular wallets first when over limit", () => {
    const readyWallets: WalletLike[] = [
      { id: "wallet.alpha", name: "Alpha" },
      { id: "wallet.beta", name: "Beta" },
      { id: "io.metamask", name: "MetaMask" },
      { id: "wallet.gamma", name: "Gamma" },
      { id: "app.keplr", name: "Keplr" },
      { id: "wallet.delta", name: "Delta" },
    ]

    const result = prioritizeSignInWallets(readyWallets, POPULAR_WALLETS, 5)

    expect(result.map((wallet) => wallet.id)).toEqual([
      "io.metamask",
      "app.keplr",
      "wallet.alpha",
      "wallet.beta",
      "wallet.gamma",
    ])
  })

  it("matches popular wallets by normalized name", () => {
    const readyWallets: WalletLike[] = [
      { id: "wallet.alpha", name: "Alpha" },
      { id: "wallet.beta", name: "Beta" },
      { id: "wallet.custom.leap", name: "Leap Wallet" },
      { id: "wallet.gamma", name: "Gamma" },
      { id: "wallet.delta", name: "Delta" },
      { id: "wallet.epsilon", name: "Epsilon" },
    ]

    const result = prioritizeSignInWallets(readyWallets, POPULAR_WALLETS, 5)

    expect(result.map((wallet) => wallet.id)).toEqual([
      "wallet.custom.leap",
      "wallet.alpha",
      "wallet.beta",
      "wallet.gamma",
      "wallet.delta",
    ])
  })
})
