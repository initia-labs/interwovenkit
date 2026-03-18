import type { Keplr } from "@keplr-wallet/types"
import type { CosmosWallet, CosmosWalletProvider } from "@/data/config"
import { useConfig } from "@/data/config"

declare global {
  interface Window {
    keplr?: Keplr
    leap?: Keplr
  }
}

export function useCosmosWallets() {
  const { cosmosWallets: configWallets = [] } = useConfig()

  const builtInList: CosmosWallet[] = [
    {
      name: "Keplr",
      image: "https://assets.initia.xyz/images/wallets/Keplr.webp",
      getProvider: () => window.keplr as CosmosWalletProvider | undefined,
      fallbackUrl: "https://keplr.app/get",
    },
    {
      name: "Leap",
      image: "https://assets.initia.xyz/images/wallets/Leap.webp",
      getProvider: () => window.leap as CosmosWalletProvider | undefined,
      fallbackUrl: "https://leapwallet.io/download",
    },
  ]

  // Config wallets first — intentionally added, should be prominent.
  // Dedup: config wallet with matching name replaces its built-in counterpart.
  const builtInFiltered = builtInList.filter(
    (builtIn) => !configWallets.some((cw) => cw.name === builtIn.name),
  )
  const list = [...configWallets, ...builtInFiltered]

  const find = (cosmosWalletName?: string) =>
    list.find((wallet) => wallet.name === cosmosWalletName)

  return { list, find }
}
