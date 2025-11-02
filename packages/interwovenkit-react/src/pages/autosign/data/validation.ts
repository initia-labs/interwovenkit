import type { EncodeObject } from "@cosmjs/proto-signing"
import { useAutoSignPermissions } from "./permissions"
import { useAutoSignState } from "./state"
import { canAutoSignHandleRequest } from "./utils"

/**
 * Hook that provides a validation function for auto-sign eligibility.
 * Performs comprehensive validation including message type authorization and active grant status.
 * Ensures transactions meet all requirements before bypassing manual signing.
 */
export function useValidateAutoSign() {
  const autoSignPermissions = useAutoSignPermissions()
  const autoSignState = useAutoSignState()

  return async (chainId: string, messages: EncodeObject[]): Promise<boolean> => {
    // Check if auto sign can handle this transaction type
    if (!canAutoSignHandleRequest({ messages, chainId }, autoSignPermissions)) {
      return false
    }

    // Check if auto sign is enabled for this chain
    const isAutoSignEnabled = await autoSignState.checkAutoSign()
    return isAutoSignEnabled[chainId] ?? false
  }
}
