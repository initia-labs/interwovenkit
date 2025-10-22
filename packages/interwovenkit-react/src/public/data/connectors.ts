import { toPrivyWalletProvider } from "@privy-io/cross-app-connect"
import { toPrivyWallet, toPrivyWalletConnector } from "@privy-io/cross-app-connect/rainbow-kit"
import { mainnet } from "wagmi/chains"

export const INITIA_APP_ID = "cmbq1ozyc006al70lx4uciz0q"

export const initiaPrivyWalletOptions = {
  id: INITIA_APP_ID,
  name: "Socials",
  iconUrl: "https://assets.initia.xyz/images/wallets/Privy.webp",
  iconBackground: "#ffffff",
}

// wagmi
export const initiaPrivyWalletConnector = toPrivyWalletConnector(initiaPrivyWalletOptions)

// RainbowKit
export const initiaPrivyWallet = toPrivyWallet(initiaPrivyWalletOptions)

const uuid = crypto.randomUUID()

export function injectEip6369Wallet() {
  const initiaWalletProvider = toPrivyWalletProvider({
    providerAppId: INITIA_APP_ID,
    chains: [mainnet],
  })

  // EIP-6963 provider detail
  const providerDetail = {
    info: {
      uuid,
      name: initiaPrivyWalletOptions.name,
      icon: initiaPrivyWalletOptions.iconUrl,
      rdns: INITIA_APP_ID,
    },
    provider: initiaWalletProvider,
  }

  // Function to announce the provider
  const announceProvider = () => {
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: Object.freeze(providerDetail),
      }),
    )
  }

  // Immediately announce the provider when injected
  announceProvider()

  // Listen for provider requests and re-announce when requested
  window.addEventListener("eip6963:requestProvider", announceProvider)

  return () => window.removeEventListener("eip6963:requestProvider", announceProvider)
}
