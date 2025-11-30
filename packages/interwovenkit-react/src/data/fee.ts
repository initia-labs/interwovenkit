import { Secp256k1 } from "@cosmjs/crypto"
import { fromBase64, toHex } from "@cosmjs/encoding"
import type { Coin } from "@cosmjs/proto-signing"
import { calculateFee, GasPrice, type StdFee } from "@cosmjs/stargate"
import BigNumber from "bignumber.js"
import { computeAddress } from "ethers"
import ky from "ky"
import { descend, isNil } from "ramda"
import { useMemo, useState } from "react"
import { useSuspenseQuery } from "@tanstack/react-query"
import { InitiaAddress } from "@initia/utils"
import { useTxs } from "@/pages/wallet/tabs/activity/queries"
import { DEFAULT_GAS_ADJUSTMENT, DEFAULT_GAS_PRICE_MULTIPLIER } from "@/public/data/constants"
import { useInitiaAddress } from "@/public/data/hooks"
import { chainQueryKeys, type NormalizedChain } from "./chains"
import { STALE_TIMES } from "./http"

export interface FeeDetails {
  symbol: string
  decimals: number
  spend: string | null
  fee: string
  total: string
  balance: string
  isSufficient: boolean
}

interface GetFeeDetailsParams {
  feeDenom: string
  balances: Coin[]
  feeOptions: StdFee[]
  spendAmount?: BigNumber
  findAsset: (denom: string) => { symbol: string; decimals: number }
}

export function getFeeDetails({
  feeDenom,
  balances,
  feeOptions,
  spendAmount = BigNumber(0),
  findAsset,
}: GetFeeDetailsParams): FeeDetails {
  const balance = balances.find((b) => b.denom === feeDenom)?.amount ?? "0"
  const feeAmount =
    feeOptions.find((fee) => fee.amount[0].denom === feeDenom)?.amount[0]?.amount ?? "0"
  const totalRequired = BigNumber(feeAmount).plus(spendAmount)
  const isSufficient = BigNumber(balance).gte(totalRequired)
  const { symbol, decimals } = findAsset(feeDenom)

  return {
    symbol,
    decimals,
    spend: spendAmount.gt(0) ? spendAmount.toFixed() : null,
    fee: feeAmount,
    total: totalRequired.toFixed(),
    balance,
    isSufficient,
  }
}

export function useGasPrices(chain: NormalizedChain) {
  const { data } = useSuspenseQuery({
    queryKey: chainQueryKeys.gasPrices(chain).queryKey,
    queryFn: async () => {
      if (chain.metadata?.is_l1) {
        const { restUrl } = chain
        const { gas_prices } = await ky
          .create({ prefixUrl: restUrl })
          .get("initia/tx/v1/gas_prices")
          .json<{ gas_prices: Coin[] }>()
        return gas_prices
          .toSorted(descend(({ denom }) => denom === "uinit"))
          .map(({ denom, amount }) => {
            const multiplier = denom === "uinit" ? 1 : DEFAULT_GAS_PRICE_MULTIPLIER
            const price = BigNumber(amount).times(multiplier).toFixed(18)
            return { amount: price, denom }
          })
      }
      return chain.fees.fee_tokens.map(({ denom, fixed_min_gas_price: price }) => {
        if (isNil(price)) throw new Error(`${denom} has no price`)
        return { amount: String(price), denom }
      })
    },
    staleTime: STALE_TIMES.SECOND,
  })

  return data
}

export function useLastFeeDenom(chain: NormalizedChain) {
  const address = useInitiaAddress()
  // Only fetch txs if there are multiple fee tokens to choose from
  // With 1 token, we don't need transaction history to determine the last used denom
  const { data: txs } = useTxs(chain, { enabled: chain.fees.fee_tokens.length >= 2 })

  if (chain.fees.fee_tokens.length === 0) {
    return null
  }

  const defaultDenom = chain.fees.fee_tokens[0].denom

  if (chain.fees.fee_tokens.length === 1) {
    return defaultDenom
  }

  try {
    const lastTx = txs.find(({ tx }) =>
      tx.auth_info.signer_infos.some((info) => {
        return InitiaAddress.equals(
          address,
          computeAddress(`0x${toHex(Secp256k1.uncompressPubkey(fromBase64(info.public_key.key)))}`),
        )
      }),
    )

    return lastTx?.tx.auth_info.fee.amount[0]?.denom ?? defaultDenom
  } catch {
    return defaultDenom
  }
}

interface UseTxFeeParams {
  chain: NormalizedChain
  estimatedGas: number
}

interface UseTxFeeResult {
  gasPrices: Coin[]
  gas: number
  feeOptions: StdFee[]
  feeDenom: string
  setFeeDenom: (denom: string) => void
  getFee: () => StdFee | undefined
}

export function useTxFee({ chain, estimatedGas }: UseTxFeeParams): UseTxFeeResult {
  const gasPrices = useGasPrices(chain)
  const lastFeeDenom = useLastFeeDenom(chain)

  const gas = Math.ceil(estimatedGas * DEFAULT_GAS_ADJUSTMENT)

  const feeOptions = useMemo(
    () =>
      gasPrices.map(({ amount, denom }) => calculateFee(gas, GasPrice.fromString(amount + denom))),
    [gasPrices, gas],
  )

  const getInitialFeeDenom = () => {
    if (lastFeeDenom) {
      const hasFee = feeOptions.some((fee) => fee.amount[0].denom === lastFeeDenom)
      if (hasFee) return lastFeeDenom
    }
    return feeOptions[0]?.amount[0]?.denom
  }

  const [feeDenom, setFeeDenom] = useState(getInitialFeeDenom)

  const getFee = () => feeOptions.find((fee) => fee.amount[0].denom === feeDenom)

  return { gasPrices, gas, feeOptions, feeDenom, setFeeDenom, getFee }
}
