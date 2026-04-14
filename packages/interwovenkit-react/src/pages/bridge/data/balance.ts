import type { BalanceResponseDenomEntryJson, BalancesResponseJson } from "@skip-go/client"
import type { KyInstance } from "ky"
import { path } from "ramda"
import { useQuery } from "@tanstack/react-query"
import { STALE_TIMES } from "@/data/http"
import { useValidateAddress } from "./address"
import { skipQueryKeys, useSkip } from "./skip"

async function fetchSkipBalancesForChain(
  skip: KyInstance,
  chainId: string,
  address: string,
): Promise<Record<string, BalanceResponseDenomEntryJson>> {
  const { chains } = await skip
    .post("v2/info/balances", { json: { chains: { [chainId]: { address, denoms: [] } } } })
    .json<BalancesResponseJson>()
  return chains?.[chainId]?.denoms ?? {}
}

export function useSkipBalancesQuery(address: string, chainId: string) {
  const skip = useSkip()
  const validateAddress = useValidateAddress()
  const isValidAddress = !!chainId && !!address && validateAddress(address, chainId)

  return useQuery({
    // eslint-disable-next-line @tanstack/query/exhaustive-deps -- skip is a stable ky instance from useMemo
    queryKey: skipQueryKeys.balances(chainId, address).queryKey,
    queryFn: () => fetchSkipBalancesForChain(skip, chainId, address),
    select: (denoms) => {
      if (!isValidAddress) return {}
      return denoms
    },
    enabled: isValidAddress,
    staleTime: STALE_TIMES.SECOND,
  })
}

export function useSkipBalance(address: string, chainId: string, denom: string) {
  const { data: balances = {} } = useSkipBalancesQuery(address, chainId)
  return path<BalanceResponseDenomEntryJson>([denom], balances)
}
