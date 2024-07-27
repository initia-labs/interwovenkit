import { ascend, descend, sortWith } from "ramda"
import { useSuspenseQuery } from "@tanstack/react-query"
import type { ChainJson } from "@skip-go/client"
import type { Chain } from "@initia/initia-registry-types"
import { STALE_TIMES } from "@/data/http"
import { useInitiaRegistry } from "@/data/chains"
import { skipQueryKeys, useSkip } from "./skip"

export interface RouterChainJson extends ChainJson {
  rpc: string
  rest: string
  hidden?: boolean
  evm_fee_asset?: {
    name: string
    symbol: string
    decimals: number
  }
}

export function useGetIsInitiaChain() {
  const chains = useInitiaRegistry()
  return (chainId: string) => chains.some((chain: Chain) => chain.chain_id === chainId)
}

export function useFindChainType() {
  const getIsInitiaChain = useGetIsInitiaChain()
  return (chain: ChainJson) => {
    const isInitiaChain = getIsInitiaChain(chain.chain_id)
    return isInitiaChain ? "initia" : chain.chain_type
  }
}

export function useChainType(chain: ChainJson) {
  const findChainType = useFindChainType()
  return findChainType(chain)
}

export function useSkipChains() {
  const skip = useSkip()
  const { data } = useSuspenseQuery({
    queryKey: skipQueryKeys.chains.queryKey,
    queryFn: () => skip.get("v2/info/chains").json<{ chains: RouterChainJson[] }>(),
    select: ({ chains }) =>
      sortWith(
        [
          descend(({ chain_name }) => chain_name === "initia"),
          ascend(({ pretty_name }) => pretty_name),
        ],
        chains,
      ),
    staleTime: STALE_TIMES.MINUTE,
  })
  return data
}

export function useFindSkipChain() {
  const chains = useSkipChains()
  return (chainId: string) => {
    const chain = chains.find((chain) => chain.chain_id === chainId)
    if (!chain) throw new Error(`Chain not found: ${chainId}`)
    return chain
  }
}

export function useSkipChain(chainId: string) {
  const findSkipChain = useFindSkipChain()
  return findSkipChain(chainId)
}
