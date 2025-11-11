import { useAccount } from "wagmi"
import { useEffect } from "react"
import { useAtomValue } from "jotai"
import { useConfig } from "@/data/config"
import { useDisconnect } from "@/data/ui"
import { pendingConnectorIdAtom } from "@/pages/connect/atoms"
import useIsPrivyConnected from "./useIsPrivyConnected"
import useLoginPrivy from "./useLoginPrivy"

/* Reset wagmi connection if privy is disconnected (session expired or is first visit after intervowenkit update) */
const useSyncPrivyAuth = () => {
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

export default useSyncPrivyAuth
