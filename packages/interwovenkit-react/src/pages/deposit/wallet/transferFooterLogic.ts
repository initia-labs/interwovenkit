import BigNumber from "bignumber.js"

interface FeeDetails {
  balance: string
  fee: string
  isSufficient: boolean
}

interface GetTransferFeeWarningParams {
  sourceDenom: string
  feeDetailsByDenom: Map<string, FeeDetails>
}

export function getTransferFeeWarning({
  sourceDenom,
  feeDetailsByDenom,
}: GetTransferFeeWarningParams): string | undefined {
  const sourceFee = feeDetailsByDenom.get(sourceDenom)
  if (!sourceFee || sourceFee.isSufficient) return

  for (const [denom, feeDetails] of feeDetailsByDenom) {
    if (denom !== sourceDenom && feeDetails.isSufficient) return
  }

  // `sourceFee.fee` is the amount field on a `calculateFee(...)` result built
  // by the only call site (TransferFooter), which always emits a numeric
  // string, so `|| 0` here is purely defensive against future callers — empty
  // input does not occur on the live path.
  const canCoverFeeWithoutSpendingSource = BigNumber(sourceFee.balance || 0).gte(sourceFee.fee || 0)
  if (!canCoverFeeWithoutSpendingSource) return

  return "Make sure to leave enough for transaction fee"
}

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
