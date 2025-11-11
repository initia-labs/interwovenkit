import { Secp256k1 } from "@cosmjs/crypto"
import { fromHex, toHex } from "@cosmjs/encoding"
import { ethers } from "ethers"
import { useSignMessage } from "wagmi"
import { useCallback, useEffect, useRef } from "react"
import { InitiaAddress } from "@initia/utils"
import { useConfig } from "@/data/config"
import { LocalStorageKey } from "@/data/constants"
import { useDisconnect } from "@/data/ui"
import { useInitiaAddress } from "@/public/data/hooks"

/* Hook that updates the privy auth state every time the connected wallet changes */
export function useSyncPrivyAuth() {
  const { privyContext } = useConfig()
  const address = useInitiaAddress()
  const { signMessageAsync } = useSignMessage()
  const disconnect = useDisconnect()
  const storePubKey = useStorePubKey()

  const isPrivyReady = privyContext?.privy.ready
  // Use bech32 for comparison since it is always lower case
  const userAddress = privyContext?.privy.user?.wallet?.address
  const privyAddress = userAddress ? InitiaAddress(userAddress).bech32 : undefined

  // Use a ref to always have access to the latest privyContext
  const privyContextRef = useRef(privyContext)

  // Update ref in an effect to avoid updating during render
  useEffect(() => {
    privyContextRef.current = privyContext
  }, [privyContext])

  // Helper function to wait for authentication state changes
  const waitForAuthState = useCallback(
    async (targetState: boolean, timeoutMs: number = 3000): Promise<void> => {
      const startTime = Date.now()
      while (
        privyContextRef.current?.privy.authenticated !== targetState &&
        Date.now() - startTime < timeoutMs
      ) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    },
    [],
  )

  // Every time the wallet changes keep wagmi wallet and privy wallet the same
  useEffect(() => {
    async function updatePrivyAccount() {
      // if privy is not enabled or not ready yet - just ignore this
      if (!privyContextRef.current || !isPrivyReady) return

      // if there is no wallet connected or if user is already logged in no action is needed
      if (!address || privyAddress === address) return

      // if the user is logged in to the wrong account - log out
      if (privyAddress) {
        await privyContextRef.current.privy.logout()
        // this is needed due to an issue with privy state not updating quick enough
        await waitForAuthState(false)
      }

      try {
        // attempt to login using siwe
        const message = await privyContextRef.current.siwe.generateSiweMessage({
          chainId: "eip155:1",
          address: InitiaAddress(address).hex,
        })
        if (!message) throw new Error("unable to create siwe message")
        const signature = await signMessageAsync({ message })
        // use this signature to cache the pubkey (so the user doesn't need to sign another tx for that)
        storePubKey({ message, signature })
        await privyContextRef.current.siwe.loginWithSiwe({ signature, message })
      } catch {
        // if the login fails - disconnect the wallet (so we don't end up with the wallet connecte but not logged in)
        disconnect()
      }
    }
    updatePrivyAccount()

    // we want this to run only once, when the address changes (or when privy becomes ready)
    // to ensure that privy auth stays connected to the same wallet as wagmi
  }, [address, isPrivyReady]) // eslint-disable-line react-hooks/exhaustive-deps
}

/* Helper function to store pubkey - maybe can be moved somwhere else */
function useStorePubKey() {
  const initiaAddress = useInitiaAddress()

  return ({ message, signature }: { message: string; signature: string }) => {
    const storageKey = `${LocalStorageKey.PUBLIC_KEY}:${initiaAddress}`

    const messageHash = ethers.hashMessage(message)
    const uncompressedPublicKey = ethers.SigningKey.recoverPublicKey(messageHash, signature)
    const publicKey = Secp256k1.compressPubkey(fromHex(uncompressedPublicKey.replace("0x", "")))

    localStorage.setItem(storageKey, toHex(publicKey))
  }
}
