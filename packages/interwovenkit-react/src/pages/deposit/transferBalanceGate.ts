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

export function hasSufficientTransferBalance({
  balance,
  requiredAmount,
}: HasSufficientTransferBalanceArgs): boolean {
  return requiredAmount === "0" || BigNumber(balance ?? "0").gte(requiredAmount)
}
