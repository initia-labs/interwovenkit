import { useDefaultChain } from "@/data/chains"
import { useConfig } from "@/data/config"

/**
 * Maps a chain type to its corresponding Cosmos message type URL.
 * Determines the appropriate message type for transaction execution based on the chain's VM type.
 */
function mapChainTypeToMessageType(chainType?: string) {
  switch (chainType) {
    case "minievm":
      return "/minievm.evm.v1.MsgCall"
    case "miniwasm":
      return "/cosmwasm.wasm.v1.MsgExecuteContract"
    default:
      return "/initia.move.v1.MsgExecute"
  }
}

/**
 * Hook that retrieves auto-sign permissions configuration for each chain.
 * Returns a mapping of chain IDs to allowed message types based on the app configuration.
 * Handles both boolean and detailed permission configurations, automatically determining
 * message types based on chain characteristics when using boolean config.
 */
export function useAutoSignPermissions() {
  const { enableAutoSign } = useConfig()
  const defaultChain = useDefaultChain()

  if (!enableAutoSign) {
    return {}
  }

  if (typeof enableAutoSign === "boolean" && enableAutoSign) {
    const messageType = mapChainTypeToMessageType(defaultChain.metadata?.minitia?.type)
    return { [defaultChain.chainId]: [messageType] }
  }

  return enableAutoSign
}
