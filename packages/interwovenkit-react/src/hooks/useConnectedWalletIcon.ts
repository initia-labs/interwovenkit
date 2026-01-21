import { useAccount } from "wagmi"

export function useConnectedWalletIcon() {
  const { connector } = useAccount()

  if (!connector) return undefined

  return connector.id === "io.privy.wallet"
    ? "https://assets.initia.xyz/images/wallets/Privy.webp"
    : connector.icon
}
