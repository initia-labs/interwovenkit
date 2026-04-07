import type { TxJson } from "@skip-go/client"

interface ExactFeeCheckRoute {
  required_op_hook?: boolean
}

export function shouldCheckExactFee({
  isDstInitia,
  recipient,
  route,
  sender,
  isSrcInitia,
  tx,
}: {
  isDstInitia: boolean
  recipient?: string
  route?: ExactFeeCheckRoute
  sender?: string
  isSrcInitia: boolean
  tx: TxJson
}): boolean {
  return (
    !!route &&
    "cosmos_tx" in tx &&
    !!tx.cosmos_tx.msgs?.length &&
    !route.required_op_hook &&
    isSrcInitia &&
    isDstInitia &&
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
