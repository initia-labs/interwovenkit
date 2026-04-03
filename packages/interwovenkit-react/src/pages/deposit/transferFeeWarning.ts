interface FeeDetails {
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

  const hasAlternativeFeeBalance = Array.from(feeDetailsByDenom.entries()).some(
    ([denom, feeDetails]) => denom !== sourceDenom && feeDetails.isSufficient,
  )
  if (hasAlternativeFeeBalance) return

  return "Make sure to leave enough for transaction fee"
}
