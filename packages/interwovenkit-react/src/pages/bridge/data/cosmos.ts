import type { Keplr } from "@keplr-wallet/types"

declare global {
  interface Window {
    keplr?: Keplr
    leap?: Keplr
  }
}

export function useCosmosWallets() {
  const list = [
    {
      name: "Keplr",
      image: "https://assets.initia.xyz/images/wallets/Keplr.webp",
      getProvider: () => window.keplr,
      fallbackUrl: "https://keplr.app/get",
    },
    {
      name: "Leap",
      image: "https://assets.initia.xyz/images/wallets/Leap.webp",
      getProvider: () => window.leap,
      fallbackUrl: "https://leapwallet.io/download",
    },
  ]

  const find = (cosmosWalletName?: string) =>
    list.find((wallet) => wallet.name === cosmosWalletName)

  return { list, find }
}
