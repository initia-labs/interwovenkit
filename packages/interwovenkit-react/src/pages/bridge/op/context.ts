import { createContext, useContext } from "react"
import type { WithdrawalTx } from "./data"

export const OpWithdrawalContext = createContext<{ chainId: string; withdrawalTx: WithdrawalTx }>(
  null!,
)

export function useOpWithdrawal() {
  return useContext(OpWithdrawalContext)
}
