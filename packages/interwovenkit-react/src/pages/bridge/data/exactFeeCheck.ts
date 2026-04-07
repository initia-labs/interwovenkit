import type { TxJson } from "@skip-go/client"
import type { NormalizedChain } from "@/data/chains"

interface ExactFeeCheckRoute {
  amount_in: string
  required_op_hook?: boolean
}

interface ExactFeeCheckSetup {
  balanceKey: string
}

function getFeeBalanceKey({
  balances,
  feeDenoms,
}: {
  balances?: Record<string, { amount?: string }>
  feeDenoms: string[]
}): string {
  if (!balances) return ""

  return feeDenoms
    .toSorted()
    .map((denom) => `${denom}:${balances[denom]?.amount ?? "0"}`)
    .join("|")
}

export function getExactFeeCheckSetup({
  balances,
  dstChainType,
  findChain,
  recipient,
  route,
  sender,
  srcChainId,
  srcChainType,
  srcDenom,
  tx,
}: {
  balances?: Record<string, { amount?: string }>
  dstChainType: string
  findChain: (chainId: string) => NormalizedChain
  recipient?: string
  route?: ExactFeeCheckRoute
  sender?: string
  srcChainId: string
  srcChainType: string
  srcDenom: string
  tx: TxJson
}): ExactFeeCheckSetup | null {
  const requiresExactFeeCheck =
    !!route &&
    "cosmos_tx" in tx &&
    !!tx.cosmos_tx.msgs?.length &&
    !route.required_op_hook &&
    srcChainType === "initia" &&
    dstChainType === "initia" &&
    !!sender &&
    !!recipient

  if (!requiresExactFeeCheck) return null

  const chain = findChain(srcChainId)
  const feeDenoms = Array.from(
    new Set([srcDenom, ...chain.fees.fee_tokens.map(({ denom }) => denom)]),
  )

  return {
    balanceKey: getFeeBalanceKey({ balances, feeDenoms }),
  }
}
