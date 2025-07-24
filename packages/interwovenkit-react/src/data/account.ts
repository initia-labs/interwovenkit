import ky from "ky"
import { descend, sortWith } from "ramda"
import BigNumber from "bignumber.js"
import type { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin"
import { useSuspenseQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { createUsernameClient } from "@/public/utils"
import { useInitiaAddress } from "@/public/data/hooks"
import { useConfig } from "./config"
import { STALE_TIMES } from "./http"
import { useLayer1, usePricesQuery, type NormalizedChain } from "./chains"
import { useAssets, useFindAsset, useGetLayer1Denom } from "./assets"

export const accountQueryKeys = createQueryKeys("interwovenkit:account", {
  username: (restUrl: string, address: string) => [restUrl, address],
  address: (restUrl: string, username: string) => [restUrl, username],
  balances: (restUrl: string, address: string) => [restUrl, address],
  txs: (indexerUrl: string, address: string) => [indexerUrl, address],
})

export function useUsernameClient() {
  const { restUrl } = useLayer1()
  const { usernamesModuleAddress } = useConfig()
  return createUsernameClient({ restUrl, moduleAddress: usernamesModuleAddress })
}

export function useBalances(chain: NormalizedChain) {
  const address = useInitiaAddress()
  const { restUrl } = chain
  const { data } = useSuspenseQuery({
    queryKey: accountQueryKeys.balances(restUrl, address).queryKey,
    queryFn: () =>
      ky
        .create({ prefixUrl: restUrl })
        .get(`cosmos/bank/v1beta1/balances/${address}`)
        .json<{ balances: Coin[] }>(),
    select: ({ balances }) => balances,
    staleTime: STALE_TIMES.SECOND,
  })
  return data
}

export function useSortedBalancesWithValue(chain: NormalizedChain) {
  const balances = useBalances(chain)
  const assets = useAssets(chain)
  const findAsset = useFindAsset(chain)
  const getLayer1Denom = useGetLayer1Denom(chain)

  const { data: prices } = usePricesQuery(chain.chainId)

  const isFeeToken = (denom: string) => {
    return chain.fees.fee_tokens.some((token) => token.denom === denom)
  }

  const isListed = (denom: string) => {
    return assets.some((asset) => asset.denom === denom)
  }

  return sortWith(
    [
      descend(({ denom }) => getLayer1Denom(denom) === "uinit"),
      descend(({ denom }) => isFeeToken(denom)),
      descend(({ value }) => value),
      descend(({ denom }) => isListed(denom)),
      ({ balance: a }, { balance: b }) => BigNumber(b).comparedTo(a) ?? 0,
      descend(({ symbol }) => symbol.toLowerCase()),
    ],
    balances
      .filter(({ amount }) => !BigNumber(amount).isZero())
      .map(({ amount: balance, denom }) => {
        const asset = findAsset(denom)
        const price = prices?.find(({ id }) => id === asset?.denom)?.price ?? 0
        const value = BigNumber(balance)
          .times(price)
          .div(BigNumber(10).pow(asset.decimals))
          .toNumber()
        return { ...asset, balance, price, value }
      }),
  )
}
