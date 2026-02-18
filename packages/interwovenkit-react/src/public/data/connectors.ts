import { toPrivyWallet, toPrivyWalletConnector } from "@privy-io/cross-app-connect/rainbow-kit"

export const PRIVY_APP_ID = "cmlqt67n7002t0bl44nei2pun"

export const initiaPrivyWalletOptions = {
  id: PRIVY_APP_ID,
  name: "Socials",
  iconUrl: "https://assets.initia.xyz/images/wallets/Privy.webp",
  iconBackground: "#ffffff",
}

// wagmi
export const initiaPrivyWalletConnector = toPrivyWalletConnector(initiaPrivyWalletOptions)

// RainbowKit
export const initiaPrivyWallet = toPrivyWallet(initiaPrivyWalletOptions)
