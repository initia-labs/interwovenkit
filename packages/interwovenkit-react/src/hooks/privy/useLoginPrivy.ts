import { useAccount, useSignMessage } from "wagmi"
import { useCallback, useEffect, useRef } from "react"
import { useConfig } from "@/data/config"
import useIsPrivyConnected from "./useIsPrivyConnected"

/* Hook that updates the privy auth state every time the connected wallet changes */
function useLoginPrivy() {
  const { privyContext } = useConfig()
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const isPrivyConnected = useIsPrivyConnected()

  const isPrivyReady = privyContext?.privy.ready

  // Use a ref to always have access to the latest privy and wagmi context
  const privyContextRef = useRef(privyContext)
  const wagmiContextRef = useRef({ address, signMessageAsync })

  // Update ref in an effect to avoid updating during render
  useEffect(() => {
    privyContextRef.current = privyContext
    wagmiContextRef.current = { address, signMessageAsync }
  }, [privyContext, address, signMessageAsync])

  // Every time the wallet changes keep wagmi wallet and privy wallet the same
  return useCallback(async () => {
    // if privy is not enabled or not ready yet - just ignore this
    if (!privyContextRef.current || !isPrivyReady) return
    // if there is no wallet connected or if user is already logged in no action is needed
    if (!wagmiContextRef.current.address || isPrivyConnected) return
    // if the user is logged in to the wrong account - log out
    if (privyContextRef.current.privy.authenticated) {
      await privyContextRef.current.privy.logout()
    }

    // attempt to login using siwe
    const message = await privyContextRef.current.siwe.generateSiweMessage({
      chainId: "eip155:1",
      address: wagmiContextRef.current.address,
    })
    if (!message) throw new Error("unable to create siwe message")
    const signature = await wagmiContextRef.current.signMessageAsync({ message })
    await privyContextRef.current.siwe.loginWithSiwe({ signature, message })
  }, [isPrivyConnected, isPrivyReady])
}

export default useLoginPrivy
