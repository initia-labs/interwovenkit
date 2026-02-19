import { useAccount } from "wagmi"
import { LocalStorageKey } from "@/data/constants"
import { PRIVY_APP_ID } from "@/public/data/connectors"

interface PrivyUserInfo {
  loginMethod: string
  email: string
}

export function usePrivyUserInfo(): PrivyUserInfo | undefined {
  const { connector, address } = useAccount()
  if (connector?.id !== PRIVY_APP_ID || !address) return undefined
  const stored = localStorage.getItem(`${LocalStorageKey.PRIVY_USER_INFO}:${address}`)
  if (!stored) return undefined
  return JSON.parse(stored) as PrivyUserInfo
}
