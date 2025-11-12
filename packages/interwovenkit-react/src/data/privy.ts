import { useAccount, useSignMessage } from "wagmi"
import { useCallback, useEffect, useRef } from "react"
import { useAtomValue } from "jotai"
import { InitiaAddress } from "@initia/utils"
import { useConfig } from "@/data/config"
import { pendingConnectorIdAtom } from "@/pages/connect/atoms"
import { useDisconnect } from "./ui"

/* Hook used to detect if privy is enabled and is connected to the correct wallet */
export function useIsPrivyConnected() {
  const { privyContext } = useConfig()
  const { address: wagmiAddress } = useAccount()

  if (!privyContext) return true // no connection needed if privy is not enabled

  const privyAddresses = privyContext.privy.user?.linkedAccounts
    .map((account) => "address" in account && account.address)
    .filter((v) => !!v) as string[] | undefined

  if (!privyAddresses?.length || !wagmiAddress) return false

  return privyAddresses.some(
    (privyAddress) => InitiaAddress(privyAddress).bech32 === InitiaAddress(wagmiAddress).bech32,
  )
}

/* Hook that updates the privy auth state every time the connected wallet changes */
export function useLoginPrivy() {
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

/* Reset wagmi connection if privy is disconnected (session expired or is first visit after intervowenkit update) */
export function useSyncPrivyAuth() {
  const { privyContext } = useConfig()
  const isPrivyConnected = useIsPrivyConnected()
  const { address: wagmiAddress } = useAccount()
  const disconnect = useDisconnect()
  const loginPrivy = useLoginPrivy()
  const pendingConnectorId = useAtomValue(pendingConnectorIdAtom)

  const isPrivyReady = !!privyContext?.privy.ready

  // attempt privy login if connection is not being handled by Connect, it should happen when:
  // - user visits the page for the first time after interwovenkit has been updated
  // - app is using custom login modal
  // - user changes address in the wallet extension
  // - privy session expired but wallet is still connected
  useEffect(() => {
    // if privy is not ready or if the connection is being handled by the login page - ignore
    if (!isPrivyReady || pendingConnectorId) return

    // if wagmi is connected but privy is not
    if (wagmiAddress && !isPrivyConnected) {
      // attempt siwe login - if it fails disconnect from wagmi
      loginPrivy().catch(() => disconnect())
    }

    // this must run only as soon as privy is ready, and when the wagmi address changes
  }, [isPrivyReady, wagmiAddress]) // eslint-disable-line react-hooks/exhaustive-deps
}
