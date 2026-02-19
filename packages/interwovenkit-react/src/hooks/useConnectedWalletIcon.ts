import { useAccount } from "wagmi"
import { usePrivyUserInfo } from "./usePrivyUserInfo"

export function useConnectedWalletIcon() {
  const { connector } = useAccount()
  const privyUserInfo = usePrivyUserInfo()

  if (!connector) return undefined

  if (privyUserInfo) {
    const connectionType =
      privyUserInfo.loginMethod.charAt(0).toUpperCase() + privyUserInfo.loginMethod.slice(1)
    return `https://assets.initia.xyz/images/wallets/${connectionType}.webp`
  }

  return connector.icon
}
