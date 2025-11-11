import { useAccount } from "wagmi"
import { InitiaAddress } from "@initia/utils"
import { useConfig } from "@/data/config"

/* Hook used to detect if privy is enabled and is connected to the correct wallet */
function useIsPrivyConnected() {
  const { privyContext } = useConfig()
  const { address: wagmiAddress } = useAccount()

  if (!privyContext) return true // no connection needed if privy is not enabled

  const privyAddress = privyContext.privy.user?.wallet?.address

  if (!privyAddress || !wagmiAddress) return false

  return InitiaAddress(privyAddress).bech32 === InitiaAddress(wagmiAddress).bech32
}

export default useIsPrivyConnected
