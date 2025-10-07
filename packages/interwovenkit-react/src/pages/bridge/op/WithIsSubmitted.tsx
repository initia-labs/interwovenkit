import { useOpWithdrawal } from "./context"
import { useLatestOutput } from "./data"

import type { ReactNode } from "react"

interface Props {
  children: (cond: boolean) => ReactNode
}

const WithIsSubmitted = ({ children }: Props) => {
  const { withdrawalTx } = useOpWithdrawal()
  const latest = useLatestOutput(withdrawalTx.bridge_id)
  const isSubmitted = withdrawalTx.output_index > Number(latest?.output_index)
  return children(isSubmitted)
}

export default WithIsSubmitted
