import type { BalancesResponseJson } from "@skip-go/client"
import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { STALE_TIMES } from "@/data/http"
import type { RouterChainJson } from "@/pages/bridge/data/chains"
import { skipQueryKeys, useSkip } from "@/pages/bridge/data/skip"
import { useHexAddress, useInitiaAddress } from "@/public/data/hooks"
import { normalizeDenom } from "../data/assetOptions"

type ChainBalances = NonNullable<BalancesResponseJson["chains"]>
export type DenomBalances = NonNullable<ChainBalances[string]["denoms"]>
export type Balance = DenomBalances[string]

export function mapBalancesByChain({
  chainIds,
  chains,
}: {
  chainIds: string[]
  chains?: BalancesResponseJson["chains"]
}): Record<string, DenomBalances> {
  return Object.fromEntries(chainIds.map((chainId) => [chainId, chains?.[chainId]?.denoms ?? {}]))
}

// form vs Skip casing — see normalizeDenom
export function findBalanceByDenom(
  denomBalances: DenomBalances | undefined,
  denom: string,
): Balance | undefined {
  if (!denomBalances) return undefined
  if (denomBalances[denom]) return denomBalances[denom]
  const target = normalizeDenom(denom)
  const key = Object.keys(denomBalances).find((candidate) => normalizeDenom(candidate) === target)
  return key ? denomBalances[key] : undefined
}

function useFilteredSkipChains() {
  const skip = useSkip()

  // Non-suspense: reads from prefetched cache if available, otherwise fetches
  const { data: chainsData, error } = useQuery({
    queryKey: skipQueryKeys.chains.queryKey,
    queryFn: () => skip.get("v2/info/chains").json<{ chains: RouterChainJson[] }>(),
    select: ({ chains }) =>
      chains.filter(
        ({ chain_type, bech32_prefix }) =>
          chain_type === "evm" || (chain_type === "cosmos" && bech32_prefix === "init"),
      ),
    staleTime: STALE_TIMES.MINUTE,
  })

  return { chains: chainsData ?? [], error }
}

export function useAllBalancesQuery() {
  const skip = useSkip()
  const hexAddress = useHexAddress()
  const initAddress = useInitiaAddress()
  const { chains: filteredChains, error: chainsError } = useFilteredSkipChains()

  const chainIds = useMemo(() => filteredChains.map(({ chain_id }) => chain_id), [filteredChains])

  const { data, error, isLoading } = useQuery({
    queryKey: skipQueryKeys.allBalances(chainIds, [hexAddress, initAddress]).queryKey,
    queryFn: () => {
      const chains = Object.fromEntries(
        filteredChains.map((chain) => [
          chain.chain_id,
          { address: chain.chain_type === "evm" ? hexAddress : initAddress, denoms: [] },
        ]),
      )
      return skip.post("v2/info/balances", { json: { chains } }).json<BalancesResponseJson>()
    },
    select: ({ chains }) => {
      return mapBalancesByChain({ chainIds, chains })
    },
    enabled: !!initAddress && chainIds.length > 0,
    staleTime: STALE_TIMES.SECOND,
  })

  return { data, error, isLoading, chainsError }
}
