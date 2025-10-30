import { useDefaultChain } from "@/data/chains"
import { useConfig } from "@/data/config"

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

export function useAutoSignPermissions() {
  const { enableAutoSign } = useConfig()
  const defaultChain = useDefaultChain()

  if (!enableAutoSign) {
    return {}
  }

  if (typeof enableAutoSign === "boolean" && enableAutoSign) {
    const messageType = mapChainTypeToMessageType(defaultChain.metadata?.minitia?.type)
    if (!messageType) return {}

    return {
      [defaultChain.chainId]: [messageType],
    }
  }

  return enableAutoSign
}
