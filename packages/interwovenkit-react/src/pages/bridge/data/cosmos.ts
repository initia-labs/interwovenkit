import type { Keplr } from "@keplr-wallet/types"
import { useMemo } from "react"
import type { CosmosWallet, CosmosWalletProvider } from "@/data/config"
import { useConfig } from "@/data/config"

declare global {
  interface Window {
    keplr?: Keplr
  }
}

export function useCosmosWallets() {
  const { cosmosWallets: configWallets = [] } = useConfig()

  // Config wallets first — intentionally added, should be prominent.
  // Dedup: config wallet with matching name replaces its built-in counterpart.
  const list = useMemo(() => {
    const builtInList: CosmosWallet[] = [
      {
        name: "Keplr",
        image: "https://assets.initia.xyz/images/wallets/Keplr.webp",
        getProvider: () => window.keplr as CosmosWalletProvider | undefined,
        fallbackUrl: "https://keplr.app/get",
      },
    ]
    const builtInFiltered = builtInList.filter(
      (builtIn) => !configWallets.some((cw) => cw.name === builtIn.name),
    )
    return [...configWallets, ...builtInFiltered]
  }, [configWallets])

  const find = (cosmosWalletName?: string) =>
    list.find((wallet) => wallet.name === cosmosWalletName)

  return { list, find }
}
