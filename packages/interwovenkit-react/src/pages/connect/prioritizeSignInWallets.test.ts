import { describe, expect, it } from "vitest"
import { prioritizeSignInWallets, type WalletLike } from "./prioritizeSignInWallets"

const POPULAR_WALLETS: WalletLike[] = [
  { id: "io.rabby", name: "Rabby" },
  { id: "app.phantom", name: "Phantom" },
  { id: "app.keplr", name: "Keplr" },
  { id: "wallet.example", name: "Example" },
  { id: "io.metamask", name: "MetaMask" },
]

describe("prioritizeSignInWallets", () => {
  it("returns an empty list when the limit is zero or negative", () => {
    const readyWallets: WalletLike[] = [{ id: "wallet.alpha", name: "Alpha" }]

    expect(prioritizeSignInWallets(readyWallets, POPULAR_WALLETS, 0)).toEqual([])
    expect(prioritizeSignInWallets(readyWallets, POPULAR_WALLETS, -1)).toEqual([])
  })

  it("returns an empty list when no wallets are ready", () => {
    expect(prioritizeSignInWallets([], POPULAR_WALLETS, 5)).toEqual([])
  })

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
      { id: "wallet.custom.example", name: "Example Wallet" },
      { id: "wallet.gamma", name: "Gamma" },
      { id: "wallet.delta", name: "Delta" },
      { id: "wallet.epsilon", name: "Epsilon" },
    ]

    const result = prioritizeSignInWallets(readyWallets, POPULAR_WALLETS, 5)

    expect(result.map((wallet) => wallet.id)).toEqual([
      "wallet.custom.example",
      "wallet.alpha",
      "wallet.beta",
      "wallet.gamma",
      "wallet.delta",
    ])
  })

  it("ignores a recent wallet id that is not present", () => {
    const readyWallets: WalletLike[] = [
      { id: "wallet.alpha", name: "Alpha" },
      { id: "wallet.beta", name: "Beta" },
      { id: "io.metamask", name: "MetaMask" },
      { id: "wallet.gamma", name: "Gamma" },
      { id: "wallet.delta", name: "Delta" },
      { id: "wallet.epsilon", name: "Epsilon" },
    ]

    const result = prioritizeSignInWallets(readyWallets, POPULAR_WALLETS, 5, "wallet.missing")

    expect(result.map((wallet) => wallet.id)).toEqual([
      "io.metamask",
      "wallet.alpha",
      "wallet.beta",
      "wallet.gamma",
      "wallet.delta",
    ])
  })

  it("keeps the recent wallet visible even when five popular wallets are installed", () => {
    const readyWallets: WalletLike[] = [
      { id: "wallet.recent", name: "Recent Wallet" },
      { id: "io.rabby", name: "Rabby" },
      { id: "app.phantom", name: "Phantom" },
      { id: "app.keplr", name: "Keplr" },
      { id: "wallet.example", name: "Example" },
      { id: "io.metamask", name: "MetaMask" },
    ]

    const result = prioritizeSignInWallets(readyWallets, POPULAR_WALLETS, 5, "wallet.recent")

    expect(result.map((wallet) => wallet.id)).toEqual([
      "wallet.recent",
      "io.rabby",
      "app.phantom",
      "app.keplr",
      "wallet.example",
    ])
  })

  it("keeps a recent popular wallet in the first slot", () => {
    const readyWallets: WalletLike[] = [
      { id: "wallet.alpha", name: "Alpha" },
      { id: "io.metamask", name: "MetaMask" },
      { id: "app.keplr", name: "Keplr" },
      { id: "wallet.beta", name: "Beta" },
      { id: "wallet.gamma", name: "Gamma" },
      { id: "wallet.delta", name: "Delta" },
    ]

    const result = prioritizeSignInWallets(readyWallets, POPULAR_WALLETS, 5, "io.metamask")

    expect(result.map((wallet) => wallet.id)).toEqual([
      "io.metamask",
      "app.keplr",
      "wallet.alpha",
      "wallet.beta",
      "wallet.gamma",
    ])
  })

  it("removes only one recent wallet when duplicate ids exist", () => {
    const readyWallets: WalletLike[] = [
      { id: "wallet.duplicate", name: "Duplicate One" },
      { id: "wallet.alpha", name: "Alpha" },
      { id: "wallet.duplicate", name: "Duplicate Two" },
      { id: "io.metamask", name: "MetaMask" },
      { id: "wallet.beta", name: "Beta" },
      { id: "wallet.gamma", name: "Gamma" },
    ]

    const result = prioritizeSignInWallets(readyWallets, POPULAR_WALLETS, 5, "wallet.duplicate")

    expect(result.map((wallet) => wallet.name)).toEqual([
      "Duplicate One",
      "MetaMask",
      "Alpha",
      "Duplicate Two",
      "Beta",
    ])
  })
})
