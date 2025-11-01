import { useDefaultChain } from "@/data/chains"
import { useConfig } from "@/data/config"

function parseChainTypeToMsg(type?: string) {
  switch (type) {
    case "minievm":
      return "/minievm.evm.v1.MsgCall"
    case "minimove":
      return "/initia.move.v1.MsgExecute"
    case "miniwasm":
      return "/cosmwasm.wasm.v1.MsgExecuteContract"
    default:
      return null
  }
}

export function useAutoSignPermissions() {
  const { enableAutoSign } = useConfig()
  const defaultChain = useDefaultChain()

  if (!enableAutoSign) return {}

  if (enableAutoSign === true) {
    const msgType = parseChainTypeToMsg(defaultChain.metadata?.minitia?.type)
    if (!msgType) return {}

    return {
      [defaultChain.chainId]: [msgType],
    }
  }

  return enableAutoSign
}
