import BigNumber from "bignumber.js"
import type { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin"
import { descend, sortWith } from "ramda"
import { queryOptions, useQueries, useSuspenseQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { useInitiaAddress } from "@/public/data/hooks"
import { useAssets, useFindAsset, useGetLayer1Denom } from "./assets"
import { type NormalizedChain, useInitiaRegistry, useLayer1, usePricesQuery } from "./chains"
import { useConfig } from "./config"
import { STALE_TIMES } from "./http"
import { fetchAllPages } from "./pagination"
import { createUsernameClient } from "./username"

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

function useCreateBalancesQuery() {
  const address = useInitiaAddress()
  return (chain: NormalizedChain) => {
    return queryOptions({
      queryKey: accountQueryKeys.balances(chain.restUrl, address).queryKey,
      queryFn: () =>
        fetchAllPages<"balances", Coin>(
          `cosmos/bank/v1beta1/balances/${address}`,
          { prefixUrl: chain.restUrl },
          "balances",
        ),
      staleTime: STALE_TIMES.SECOND,
    })
  }
}

export function useBalances(chain: NormalizedChain) {
  const createBalancesQuery = useCreateBalancesQuery()
  const { data } = useSuspenseQuery(createBalancesQuery(chain))
  return data
}

export function useAllChainBalancesQueries() {
  const chains = useInitiaRegistry()
  const createBalancesQuery = useCreateBalancesQuery()
  return useQueries({
    queries: chains.map((chain) => createBalancesQuery(chain)),
  })
}

export function useSortedBalancesWithValue(chain: NormalizedChain) {
  const balances = useBalances(chain)
  const assets = useAssets(chain)
  const findAsset = useFindAsset(chain)
  const getLayer1Denom = useGetLayer1Denom(chain)

  const { data: prices } = usePricesQuery(chain)

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
