import { useEffect } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import { useDrawer } from "@/data/ui"
import { useInitiaAddress } from "@/public/data/hooks"
import { useRevokeAutoSign } from "./actions"
import { useAutoSignPermissions } from "./permissions"
import { autoSignLoadingAtom, pendingAutoSignRequestAtom, useAutoSignState } from "./state"
import { useEmbeddedWalletAddress } from "./wallet"

/**
 * Main hook for managing auto-sign functionality across different chains.
 * Provides methods to setup, revoke, and monitor auto-sign permissions and status.
 * Handles the complete lifecycle of auto-sign operations including UI interactions.
 */
export function useAutoSign() {
  const autoSignPermissions = useAutoSignPermissions()
  const autoSignState = useAutoSignState()
  const autoSignLoading = useAtomValue(autoSignLoadingAtom)
  const disableAutoSign = useRevokeAutoSign()
  const { openDrawer } = useDrawer()
  const setPendingAutoSignRequest = useSetAtom(pendingAutoSignRequestAtom)

  const enableAutoSign = async (chainId: string): Promise<void> => {
    if (!autoSignPermissions?.[chainId]?.length) {
      throw new Error("Auto sign permissions are required for the setup")
    }

    if (autoSignState.isEnabled[chainId]) {
      throw new Error("Auto sign is already enabled")
    }

    return new Promise<void>((resolve, reject) => {
      setPendingAutoSignRequest({
        resolve,
        reject,
      })

      openDrawer("/autosign/enable", { chainId })
    })
  }

  return {
    isLoading: autoSignLoading,
    enable: enableAutoSign,
    disable: disableAutoSign,
    expirations: autoSignState.expirations,
  }
}

/**
 * Hook that initializes auto-sign state when the component mounts.
 * Automatically checks and updates auto-sign status whenever the main wallet address
 * or embedded wallet address changes. Ensures auto-sign state is synchronized
 * with the current wallet configuration.
 */
export function useInitializeAutoSign() {
  const autoSignState = useAutoSignState()
  const address = useInitiaAddress()
  const embeddedWalletAddress = useEmbeddedWalletAddress()

  useEffect(() => {
    if (!embeddedWalletAddress || !address) return
    autoSignState.checkAutoSign()
    // we want to run this effect only when address or embeddedWalletAddress changes since these are the only two
    // variables that affect the auto sign state on startup
  }, [address, embeddedWalletAddress]) // eslint-disable-line react-hooks/exhaustive-deps
}
