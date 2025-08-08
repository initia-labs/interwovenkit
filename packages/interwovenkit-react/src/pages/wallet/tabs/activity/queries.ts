import ky from "ky"
import { prop } from "ramda"
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
  timestamp: Date
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
  return (chain: NormalizedChain) => {
    return queryOptions({
      queryKey: accountQueryKeys.txs(chain.indexerUrl, address).queryKey,
      queryFn: async () => {
        const searchParams = {
          "pagination.reverse": true,
          "pagination.limit": ACTIVITY_PAGINATION_LIMIT,
        }
        return ky
          .create({ prefixUrl: chain.indexerUrl })
          .get(`indexer/tx/v1/txs/by_account/${address}`, { searchParams })
          .json<Paginated<"txs", TxItem>>()
      },
      select: (data: Paginated<"txs", TxItem>) => data.txs,
      staleTime: STALE_TIMES.SECOND,
    })
  }
}

export function useTxs(chain: NormalizedChain) {
  const createTxsQuery = useCreateTxsQuery()
  return useSuspenseQuery(createTxsQuery(chain))
}

// Hook to fetch and aggregate activity data from all rollups
export const useAllActivities = () => {
  const chains = useInitiaRegistry()
  const createTxsQuery = useCreateTxsQuery()

  // Fetch transactions from all rollups in parallel
  // Each query fetches the most recent transactions for the user's address
  const queries = useQueries({
    queries: chains.map((chain) => createTxsQuery(chain)),
  })

  // Combine all transaction data from different chains
  // Filter out any null/undefined values
  const results = queries.map(prop("data"))
  const allActivities = chains
    .flatMap((chain, index) => {
      const txs = results[index]
      if (!txs) return []
      return txs.map((tx) => ({ ...tx, chain }))
    })
    .filter(Boolean) as ChainActivity[]

  // Sort all activities by timestamp in descending order (newest first)
  // This creates a unified timeline across all rollups
  const sortedActivities = allActivities.sort((a, b) => {
    const timeA = new Date(a.timestamp).getTime()
    const timeB = new Date(b.timestamp).getTime()
    return timeB - timeA
  })

  // Aggregate loading state - true if any chain is still loading
  const isLoading = queries.some((query) => query.isLoading)

  return { activities: sortedActivities, isLoading }
}
