import type { BalanceResponseDenomEntryJson, BalancesResponseJson } from "@skip-go/client"
import { path } from "ramda"
import { useQuery } from "@tanstack/react-query"
import { STALE_TIMES } from "@/data/http"
import { useValidateAddress } from "./address"
import { skipQueryKeys, useSkip } from "./skip"

export function useSkipBalancesQuery(address: string, chainId: string) {
  const skip = useSkip()
  const validateAddress = useValidateAddress()
  const isValidAddress = !!chainId && !!address && validateAddress(address, chainId)

  return useQuery({
    queryKey: skipQueryKeys.balances(chainId, address).queryKey,
    queryFn: () =>
      skip
        .post("v2/info/balances", { json: { chains: { [chainId]: { address, denoms: [] } } } })
        .json<BalancesResponseJson>(),
    select: ({ chains }) => {
      if (!isValidAddress) return {}
      if (!chains) return {}
      return chains[chainId].denoms ?? {}
    },
    enabled: isValidAddress,
    staleTime: STALE_TIMES.SECOND,
  })
}

export function useSkipBalance(address: string, chainId: string, denom: string) {
  const { data: balances = {} } = useSkipBalancesQuery(address, chainId)
  return path<BalanceResponseDenomEntryJson>([denom], balances)
}
