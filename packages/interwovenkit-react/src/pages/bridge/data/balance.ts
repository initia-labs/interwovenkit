import { path } from "ramda"
import { useQuery } from "@tanstack/react-query"
import type { BalanceResponseDenomEntryJson, BalancesResponseJson } from "@skip-go/client"
import { STALE_TIMES } from "@/data/http"
import { skipQueryKeys, useSkip } from "./skip"

export function useSkipBalancesQuery(address: string, chainId: string) {
  const skip = useSkip()
  return useQuery({
    queryKey: skipQueryKeys.balances(chainId, address).queryKey,
    queryFn: () =>
      skip
        .post("v2/info/balances", { json: { chains: { [chainId]: { address, denoms: [] } } } })
        .json<BalancesResponseJson>(),
    select: ({ chains }) => {
      if (!address) return {}
      if (!chains) return {}
      return chains[chainId].denoms ?? {}
    },
    enabled: !!address,
    staleTime: STALE_TIMES.SECOND,
  })
}

export function useSkipBalance(address: string, chainId: string, denom: string) {
  const { data: balances = {} } = useSkipBalancesQuery(address, chainId)
  return path<BalanceResponseDenomEntryJson>([denom], balances)
}
