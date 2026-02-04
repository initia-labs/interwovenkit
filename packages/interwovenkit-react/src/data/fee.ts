import { Secp256k1 } from "@cosmjs/crypto"
import { fromBase64, toHex } from "@cosmjs/encoding"
import type { Coin } from "@cosmjs/proto-signing"
import BigNumber from "bignumber.js"
import { computeAddress } from "ethers"
import ky from "ky"
import { descend, isNil } from "ramda"
import { useSuspenseQuery } from "@tanstack/react-query"
import { InitiaAddress } from "@initia/utils"
import { useTxs } from "@/pages/wallet/tabs/activity/queries"
import { DEFAULT_GAS_PRICE_MULTIPLIER } from "@/public/data/constants"
import { useInitiaAddress } from "@/public/data/hooks"
import { chainQueryKeys, type NormalizedChain } from "./chains"
import { STALE_TIMES } from "./http"

export async function fetchGasPrices(chain: NormalizedChain) {
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
}

export function useGasPrices(chain: NormalizedChain) {
  const { data } = useSuspenseQuery({
    queryKey: chainQueryKeys.gasPrices(chain).queryKey,
    queryFn: () => fetchGasPrices(chain),
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
