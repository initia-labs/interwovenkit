import { toPrivyWallet, toPrivyWalletConnector } from "@privy-io/cross-app-connect/rainbow-kit"

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
