interface GetTransferFooterStatusArgs {
  feeDenom?: string
  sourceDenom: string
  feeWarning?: string
  hasSourceBalance: boolean
  isFeeBalanceSufficient: boolean
}

interface TransferFooterStatus {
  error?: string
  warning?: string
}

export function getTransferFooterStatus({
  feeDenom,
  sourceDenom,
  feeWarning,
  hasSourceBalance,
  isFeeBalanceSufficient,
}: GetTransferFooterStatusArgs): TransferFooterStatus {
  if (!hasSourceBalance) {
    return { error: "Insufficient balance" }
  }

  const warning = feeDenom === sourceDenom ? feeWarning : undefined
  if (warning) {
    return { warning }
  }

  if (!isFeeBalanceSufficient) {
    return { error: "Insufficient balance" }
  }

  return {}
}
