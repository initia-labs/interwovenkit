import ky from "ky"
import { descend } from "ramda"
import BigNumber from "bignumber.js"
import { computeAddress } from "ethers"
import { Secp256k1 } from "@cosmjs/crypto"
import { fromBase64, toHex } from "@cosmjs/encoding"
import type { Coin } from "@cosmjs/proto-signing"
import { useSuspenseQuery } from "@tanstack/react-query"
import { DEFAULT_GAS_PRICE_MULTIPLIER } from "@/public/data/constants"
import { AddressUtils } from "@/public/utils"
import { useInitiaAddress } from "@/public/data/hooks"
import type { TxItem } from "@/pages/wallet/tabs/activity/data"
import { STALE_TIMES } from "./http"
import { chainQueryKeys, type NormalizedChain } from "./chains"
import { accountQueryKeys } from "./account"
import type { Paginated } from "./pagination"

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
        if (!price) throw new Error(`${denom} has no price`)
        return { amount: String(price), denom }
      })
    },
    staleTime: STALE_TIMES.SECOND,
  })

  return data
}

export function useLastFeeDenom(chain: NormalizedChain) {
  const address = useInitiaAddress()

  const { data: txs } = useSuspenseQuery({
    queryKey: accountQueryKeys.lastTx(chain, address).queryKey,
    queryFn: async () => {
      if (chain.fees.fee_tokens.length === 1) return []
      const searchParams = { "pagination.reverse": true }
      const { txs } = await ky
        .create({ prefixUrl: chain.indexerUrl })
        .get(`indexer/tx/v1/txs/by_account/${address}`, { searchParams })
        .json<Paginated<"txs", TxItem>>()
      return txs
    },
  })

  if (chain.fees.fee_tokens.length === 1) {
    return chain.fees.fee_tokens[0].denom
  }

  const lastTx = txs.find(({ tx }) =>
    tx.auth_info.signer_infos.some((info) => {
      return AddressUtils.equals(
        address,
        computeAddress(`0x${toHex(Secp256k1.uncompressPubkey(fromBase64(info.public_key.key)))}`),
      )
    }),
  )

  return lastTx?.tx.auth_info.fee.amount[0]?.denom ?? null
}
