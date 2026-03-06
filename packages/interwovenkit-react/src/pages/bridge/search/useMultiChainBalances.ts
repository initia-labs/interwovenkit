import type { BalanceResponseDenomEntryJson } from "@skip-go/client"
import { useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useGetDefaultAddress, useValidateAddress } from "../data/address"
import { skipQueryKeys, useSkip } from "../data/skip"

type BalanceMap = Record<string, Record<string, BalanceResponseDenomEntryJson>>

interface ValidEntry {
  chainId: string
  address: string
}

export function useMultiChainBalances(chainIds: string[]): {
  balanceMap: BalanceMap
  isLoading: boolean
} {
  const skip = useSkip()
  const queryClient = useQueryClient()
  const getDefaultAddress = useGetDefaultAddress()
  const validateAddress = useValidateAddress()

  const validEntries = useMemo(() => {
    const entries: ValidEntry[] = []
    for (const chainId of chainIds) {
      const address = getDefaultAddress(chainId)
      if (address && validateAddress(address, chainId)) {
        entries.push({ chainId, address })
      }
    }
    return entries
  }, [chainIds, getDefaultAddress, validateAddress])

  const sortedEntries = useMemo(() => {
    return validEntries.toSorted((a, b) => a.chainId.localeCompare(b.chainId))
  }, [validEntries])
  const sortedChainIds = useMemo(() => sortedEntries.map((entry) => entry.chainId), [sortedEntries])
  const sortedAddresses = useMemo(
    () => sortedEntries.map((entry) => entry.address),
    [sortedEntries],
  )

  const { data, isLoading } = useQuery({
    queryKey: skipQueryKeys.allBalances(sortedChainIds, sortedAddresses).queryKey,
    queryFn: async () => {
      const chains = Object.fromEntries(
        sortedEntries.map(({ chainId, address }) => [chainId, { address, denoms: [] }]),
      )
      const response = await skip.post("v2/info/balances", { json: { chains } }).json<{
        chains: Record<string, { denoms: Record<string, BalanceResponseDenomEntryJson> }>
      }>()

      for (const { chainId, address } of sortedEntries) {
        const chainData = response.chains?.[chainId]
        if (chainData) {
          queryClient.setQueryData(skipQueryKeys.balances(chainId, address).queryKey, {
            chains: { [chainId]: chainData },
          })
        }
      }

      return response
    },
    select: (response): BalanceMap => {
      const map: BalanceMap = {}
      for (const { chainId } of sortedEntries) {
        const denoms = response.chains?.[chainId]?.denoms
        if (denoms) map[chainId] = denoms
      }
      return map
    },
    enabled: validEntries.length > 0,
    staleTime: 30_000,
  })

  return { balanceMap: data ?? {}, isLoading }
}
