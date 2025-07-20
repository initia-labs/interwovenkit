import ky from "ky"
import type { StdFee } from "@cosmjs/amino"
import type { Event } from "@cosmjs/stargate/build/events"
import { useSuspenseInfiniteQuery } from "@tanstack/react-query"
import { useInitiaAddress } from "@/public/data/hooks"
import { STALE_TIMES } from "@/data/http"
import type { Paginated } from "@/data/pagination"
import { getNextPageParam } from "@/data/pagination"
import { accountQueryKeys } from "@/data/account"
import type { NormalizedChain } from "@/data/chains"

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

export function useTxs({ indexerUrl }: NormalizedChain) {
  const address = useInitiaAddress()

  return useSuspenseInfiniteQuery({
    queryKey: accountQueryKeys.txs(indexerUrl, address).queryKey,
    queryFn: async ({ pageParam: key = "" }) => {
      const searchParams = { "pagination.key": key || "", "pagination.reverse": true }
      return ky
        .create({ prefixUrl: indexerUrl })
        .get(`indexer/tx/v1/txs/by_account/${address}`, { searchParams })
        .json<Paginated<"txs", TxItem>>()
    },
    initialPageParam: "",
    getNextPageParam: getNextPageParam,
    staleTime: STALE_TIMES.SECOND,
  })
}
