import BigNumber from "bignumber.js"

interface FeeDetails {
  balance: string
  fee: string
  isSufficient: boolean
}

interface Params {
  sourceDenom: string
  feeDetailsByDenom: Map<string, FeeDetails>
}

export function getTransferFeeWarning({
  sourceDenom,
  feeDetailsByDenom,
}: Params): string | undefined {
  const sourceFee = feeDetailsByDenom.get(sourceDenom)
  if (!sourceFee || sourceFee.isSufficient) return

  for (const [denom, feeDetails] of feeDetailsByDenom) {
    if (denom !== sourceDenom && feeDetails.isSufficient) return
  }

  const canCoverFeeWithoutSpendingSource = BigNumber(sourceFee.balance).gte(sourceFee.fee)
  if (!canCoverFeeWithoutSpendingSource) return

  return "Make sure to leave enough for transaction fee"
}
