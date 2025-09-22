import ky from "ky"
import { prop, sortWith, descend } from "ramda"
import type { StdFee } from "@cosmjs/amino"
import type { Event } from "@cosmjs/stargate/build/events"
import { queryOptions, useQueries, useSuspenseQuery } from "@tanstack/react-query"
import { useInitiaAddress } from "@/public/data/hooks"
import { STALE_TIMES } from "@/data/http"
import type { Paginated } from "@/data/pagination"
import { accountQueryKeys } from "@/data/account"
import { useInitiaRegistry, type NormalizedChain } from "@/data/chains"

export const ACTIVITY_PAGINATION_LIMIT = 10

export interface TxItem {
  tx: {
    body: {
      messages: TxItemMessage[]
      memo: string
    }
    auth_info: {
      signer_infos: { public_key: { "@type": string; key: string } }[]
      fee: StdFee
    }
  }
  code: number
  events: Event[]
  txhash: string
  timestamp: string
}

export interface TxItemMessage {
  "@type": string
  [key: string]: unknown
}

export interface ChainActivity extends TxItem {
  chain: NormalizedChain
}

export function useCreateTxsQuery() {
  const address = useInitiaAddress()
  return (chain: NormalizedChain, options: { enabled: boolean }) => {
    return queryOptions({
      queryKey: accountQueryKeys.txs(chain.indexerUrl, address).queryKey,
      queryFn: async () => {
        if (!options.enabled) return []
        const searchParams = {
          "pagination.reverse": true,
          "pagination.limit": ACTIVITY_PAGINATION_LIMIT,
        }
        const { txs } = await ky
          .create({ prefixUrl: chain.indexerUrl })
          .get(`indexer/tx/v1/txs/by_account/${address}`, { searchParams })
          .json<Paginated<"txs", TxItem>>()
        return txs
      },
      staleTime: STALE_TIMES.SECOND,
    })
  }
}

export function useTxs(chain: NormalizedChain, options: { enabled: boolean }) {
  const createTxsQuery = useCreateTxsQuery()
  return useSuspenseQuery(createTxsQuery(chain, options))
}

/**
 * Aggregates transaction data from multiple chains and sorts by timestamp
 */
export function aggregateActivities(
  chains: NormalizedChain[],
  txResults: (TxItem[] | undefined)[],
): ChainActivity[] {
  // Combine all transaction data from different chains
  const allActivities = chains.flatMap((chain, index) => {
    const txs = txResults[index] ?? []
    return txs.map((tx) => ({ ...tx, chain }))
  })

  // Sort all activities by timestamp in descending order (newest first)
  return sortWith<ChainActivity>([descend((activity) => new Date(activity.timestamp).getTime())])(
    allActivities,
  )
}

// Hook to fetch and aggregate activity data from all chains
export const useAllActivities = () => {
  const chains = useInitiaRegistry()
  const createTxsQuery = useCreateTxsQuery()

  // Fetch transactions from all chains in parallel
  // Each query fetches the most recent transactions for the user's address
  const queries = useQueries({
    queries: chains.map((chain) => createTxsQuery(chain, { enabled: true })),
  })

  const results = queries.map(prop("data"))
  const activities = aggregateActivities(chains, results)

  // Aggregate loading state - true if any chain is still loading
  const isLoading = queries.some((query) => query.isLoading)

  return { activities, isLoading }
}
