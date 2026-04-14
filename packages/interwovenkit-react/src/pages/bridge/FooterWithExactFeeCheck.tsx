import type { TxJson } from "@skip-go/client"
import { useExactFeeCheckQuery } from "./data/preparation"
import { useBridgePreviewState } from "./data/tx"

import type { ReactNode } from "react"

interface Props {
  tx: TxJson
  children: (status: { exactFeeCheckError?: string; isCheckingFeeBalance: boolean }) => ReactNode
}

function FooterWithExactFeeCheck({ tx, children }: Props) {
  const { route, values } = useBridgePreviewState()
  const {
    data: hasFeeBalance,
    error,
    isLoading,
    balancesError,
    isLoadingBalances,
    requiresExactFeeCheck,
  } = useExactFeeCheckQuery(route, values, tx)

  if (!requiresExactFeeCheck) {
    return children({ isCheckingFeeBalance: false })
  }

  if (balancesError) {
    return children({
      exactFeeCheckError: "Failed to load balances",
      isCheckingFeeBalance: false,
    })
  }

  if (isLoadingBalances || isLoading) {
    return children({ isCheckingFeeBalance: true })
  }

  if (error) {
    return children({ exactFeeCheckError: error.message, isCheckingFeeBalance: false })
  }

  if (!hasFeeBalance) {
    return children({
      exactFeeCheckError: "Insufficient balance for fees",
      isCheckingFeeBalance: false,
    })
  }

  return children({ isCheckingFeeBalance: false })
}

export default FooterWithExactFeeCheck
