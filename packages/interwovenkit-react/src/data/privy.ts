import { useAccount, useSignMessage } from "wagmi"
import { useEffect, useEffectEvent } from "react"
import { InitiaAddress } from "@initia/utils"
import { useConfig } from "@/data/config"
import { useDisconnect } from "./ui"

export function useIsPrivyConnected() {
  const { privyContext } = useConfig()
  const { address: wagmiAddress } = useAccount()

  if (!privyContext) return true
  if (!wagmiAddress) return false

  const privyAddresses = privyContext.privy.user?.linkedAccounts
    .map((account) => "address" in account && account.address)
    .filter((address): address is string => !!address)

  return !!privyAddresses?.some((privyAddress) => InitiaAddress.equals(privyAddress, wagmiAddress))
}

export function useSyncPrivyAuth() {
  const { privyContext } = useConfig()
  const isPrivyConnected = useIsPrivyConnected()
  const { address: wagmiAddress } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const disconnect = useDisconnect()

  const isPrivyReady = !!privyContext?.privy.ready

  const loginPrivyWithSiwe = useEffectEvent(async (address: string) => {
    try {
      if (!privyContext) throw new Error("Privy context not found")
      if (privyContext.privy.authenticated) await privyContext.privy.logout()
      const message = await privyContext.siwe.generateSiweMessage({ chainId: "eip155:1", address })
      if (!message) throw new Error("Failed to generate SIWE message")
      const signature = await signMessageAsync({ message })
      await privyContext.siwe.loginWithSiwe({ signature, message })
    } catch {
      disconnect()
    }
  })

  useEffect(() => {
    if (isPrivyConnected) return
    if (!isPrivyReady) return
    if (!wagmiAddress) return
    loginPrivyWithSiwe(wagmiAddress)
  }, [isPrivyConnected, isPrivyReady, wagmiAddress])
}
