import type { EncodeObject } from "@cosmjs/proto-signing"
import { useAutoSignPermissions } from "./permissions"
import { useAutoSignState } from "./state"
import { canAutoSignHandleRequest } from "./utils"

/**
 * Hook that validates if auto sign can handle the request.
 * Returns a function that checks both message type compatibility and grant status.
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
