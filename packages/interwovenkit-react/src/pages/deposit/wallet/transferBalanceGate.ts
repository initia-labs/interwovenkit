import BigNumber from "bignumber.js"

export type TransferBalanceBlocker = "loading" | "error" | undefined

interface GetTransferBalanceBlockerArgs {
  hasBalancesSnapshot: boolean
  hasBalanceQueryError: boolean
  isBalancesLoading: boolean
}

export function getTransferBalanceBlocker({
  hasBalancesSnapshot,
  hasBalanceQueryError,
  isBalancesLoading,
}: GetTransferBalanceBlockerArgs): TransferBalanceBlocker {
  if (hasBalancesSnapshot) return undefined
  if (isBalancesLoading) return "loading"
  if (hasBalanceQueryError) return "error"
}

interface GetResolvedTransferBalanceArgs {
  hasBalancesSnapshot: boolean
  balance?: string
}

export function getResolvedTransferBalance({
  hasBalancesSnapshot,
  balance,
}: GetResolvedTransferBalanceArgs): string | undefined {
  if (!hasBalancesSnapshot) return undefined
  return balance ?? "0"
}

interface HasSufficientTransferBalanceArgs {
  balance?: string
  requiredAmount: string
}

function getNonNegativeAmount(value: string): BigNumber | null {
  if (!value) return null

  const amount = BigNumber(value)
  if (!amount.isFinite() || amount.lt(0)) return null

  return amount
}

export function hasSufficientTransferBalance({
  balance,
  requiredAmount,
}: HasSufficientTransferBalanceArgs): boolean {
  if (requiredAmount === "0") return true

  const available = getNonNegativeAmount(balance ?? "0")
  const required = getNonNegativeAmount(requiredAmount)

  if (!available || !required) return false

  return available.gte(required)
}
