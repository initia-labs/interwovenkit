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
