import { isPast } from "date-fns"
import { useAtomValue, useSetAtom } from "jotai"
import { useConfig } from "@/data/config"
import { useDrawer } from "@/data/ui"
import { useRevokeAutoSign } from "./actions"
import { pendingAutoSignRequestAtom } from "./store"
import { autoSignLoadingAtom, useAutoSignPermissions, useAutoSignState } from "./validation"

/**
 * Main hook for managing auto-sign functionality across different chains.
 * Provides methods to setup, revoke, and monitor auto-sign permissions and status.
 * Handles the complete lifecycle of auto-sign operations including UI interactions.
 */
export function useAutoSign() {
  const { defaultChainId } = useConfig()
  const autoSignPermissions = useAutoSignPermissions()
  const autoSignState = useAutoSignState()
  const autoSignLoading = useAtomValue(autoSignLoadingAtom)
  const disableAutoSign = useRevokeAutoSign()
  const { openDrawer } = useDrawer()
  const setPendingAutoSignRequest = useSetAtom(pendingAutoSignRequestAtom)

  const enableAutoSign = async (chainId = defaultChainId): Promise<void> => {
    if (!autoSignPermissions?.[chainId]?.length) {
      throw new Error("Auto sign permissions are required for the setup")
    }

    const expiration = autoSignState.expirations[chainId]
    if (expiration && isPast(new Date(expiration))) {
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
    expiration: autoSignState.expirations[defaultChainId]
      ? new Date(autoSignState.expirations[defaultChainId])
      : null,
    expirations: autoSignState.expirations,
  }
}
