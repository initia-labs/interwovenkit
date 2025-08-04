import type { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin"
import BigNumber from "bignumber.js"

function createAvailableFeeOptions({
  balances,
  gasPrices,
  gas,
}: {
  balances: Coin[]
  gasPrices: Coin[]
  gas: number
}) {
  return gasPrices
    .map(({ denom, amount: price }) => {
      const amount = BigNumber(price).times(gas).toFixed(0, BigNumber.ROUND_CEIL)
      const balance = balances.find((coin) => coin.denom === denom)?.amount ?? "0"
      return { amount, denom, balance }
    })
    .filter(({ amount, balance }) => BigNumber(balance).gte(amount))
}

export function calcMaxAmount({
  denom,
  balances,
  gasPrices,
  lastFeeDenom,
  gas,
}: {
  denom: string
  balances: Coin[]
  gasPrices: Coin[]
  lastFeeDenom: string | null
  gas: number
}) {
  const balance = balances.find((coin) => coin.denom === denom)?.amount ?? "0"
  const availableFeeOptions = createAvailableFeeOptions({ balances, gasPrices, gas })
  const lastFeeOption = availableFeeOptions.find((option) => option.denom === lastFeeDenom)

  if (availableFeeOptions.length === 0) {
    return "0"
  }

  if (denom === lastFeeDenom && lastFeeOption) {
    const amount = BigNumber(balance).minus(lastFeeOption.amount)
    return BigNumber.max(amount, 0).toString()
  }

  const [preferredFeeOption] = availableFeeOptions
  if (!lastFeeOption && denom === preferredFeeOption.denom) {
    const amount = BigNumber(balance).minus(preferredFeeOption.amount)
    return BigNumber.max(amount, 0).toString()
  }

  return BigNumber(balance).toString()
}
