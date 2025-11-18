import { useAccount, useSignMessage } from "wagmi"
import { useEffect, useRef } from "react"
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

  // Store privyContext in a ref to access the latest value inside loginPrivyWithSiwe
  // without including it in the dependency array of the login effect, which would cause
  // unnecessary re-executions when privyContext changes.
  const privyContextRef = useRef(privyContext)
  useEffect(() => {
    privyContextRef.current = privyContext
  }, [privyContext])

  const loginPrivyWithSiwe = async (address: string) => {
    try {
      if (!privyContextRef.current) throw new Error("Privy context not found")
      if (privyContextRef.current.privy.authenticated) await privyContextRef.current.privy.logout()
      const message = await privyContextRef.current.siwe.generateSiweMessage({
        chainId: "eip155:1",
        address,
      })
      if (!message) throw new Error("Failed to generate SIWE message")
      const signature = await signMessageAsync({ message })
      await privyContextRef.current.siwe.loginWithSiwe({ signature, message })
    } catch {
      disconnect()
    }
  }

  useEffect(() => {
    if (isPrivyConnected) return
    if (!isPrivyReady) return
    if (!wagmiAddress) return
    loginPrivyWithSiwe(wagmiAddress)
    // loginPrivyWithSiwe is intentionally excluded from dependencies to avoid infinite loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPrivyConnected, isPrivyReady, wagmiAddress])
}
