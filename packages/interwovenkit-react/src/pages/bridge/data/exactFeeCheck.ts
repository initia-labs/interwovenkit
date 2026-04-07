import type { TxJson } from "@skip-go/client"

interface ExactFeeCheckRoute {
  required_op_hook?: boolean
}

export function shouldCheckExactFee({
  dstChainType,
  recipient,
  route,
  sender,
  srcChainType,
  tx,
}: {
  dstChainType: string
  recipient?: string
  route?: ExactFeeCheckRoute
  sender?: string
  srcChainType: string
  tx: TxJson
}): boolean {
  return (
    !!route &&
    "cosmos_tx" in tx &&
    !!tx.cosmos_tx.msgs?.length &&
    !route.required_op_hook &&
    srcChainType === "initia" &&
    dstChainType === "initia" &&
    !!sender &&
    !!recipient
  )
}

export function shouldRunExactFeeQuery({
  hasBalances,
  hasChain,
  requiresExactFeeCheck,
}: {
  hasBalances: boolean
  hasChain: boolean
  requiresExactFeeCheck: boolean
}) {
  return requiresExactFeeCheck && hasBalances && hasChain
}
