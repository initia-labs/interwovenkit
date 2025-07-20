import type { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin"
import BigNumber from "bignumber.js"

export const FIXED_GAS = 200000

export function createAvailableFeeOptions({
  balances,
  gasPrices,
}: {
  balances: Coin[]
  gasPrices: Coin[]
}) {
  return gasPrices
    .map(({ denom, amount: price }) => {
      const amount = BigNumber(price).times(FIXED_GAS).toFixed(0, BigNumber.ROUND_CEIL)
      const balance = balances.find((coin) => coin.denom === denom)?.amount ?? "0"
      return { amount, denom, balance }
    })
    .filter(({ amount, balance }) => BigNumber(balance).gte(amount))
}

export function getMaxAmount({
  denom,
  balances,
  gasPrices,
  lastFeeDenom,
}: {
  denom: string
  balances: Coin[]
  gasPrices: Coin[]
  lastFeeDenom: string | null
}) {
  const balance = balances.find((coin) => coin.denom === denom)?.amount ?? "0"
  const availableFeeOptions = createAvailableFeeOptions({ balances, gasPrices })
  const lastFeeOption = availableFeeOptions.find((option) => option.denom === lastFeeDenom)

  if (denom === lastFeeDenom && lastFeeOption) {
    const amount = BigNumber(balance).minus(lastFeeOption.amount)
    return BigNumber.max(amount, 0).toString()
  }

  const currentFeeOption = availableFeeOptions.find((option) => option.denom === denom)
  if (!lastFeeOption && currentFeeOption) {
    const amount = BigNumber(balance).minus(currentFeeOption.amount)
    return BigNumber.max(amount, 0).toString()
  }

  if (availableFeeOptions.length === 0) {
    return "0"
  }

  return BigNumber(balance).toString()
}
