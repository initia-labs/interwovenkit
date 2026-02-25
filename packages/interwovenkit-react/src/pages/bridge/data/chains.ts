import type { ChainJson } from "@skip-go/client"
import { ascend, descend, sortWith } from "ramda"
import { useSuspenseQuery } from "@tanstack/react-query"
import type { Chain } from "@initia/initia-registry-types"
import { useInitiaRegistry, useProfilesRegistry } from "@/data/chains"
import { STALE_TIMES } from "@/data/http"
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

export function isInitiaAppchain(
  chain: Pick<ChainJson, "chain_id" | "chain_name">,
  getIsInitiaChain: (chainId: string) => boolean,
): boolean {
  return getIsInitiaChain(chain.chain_id) && chain.chain_name.toLowerCase() !== "initia"
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
  const profiles = useProfilesRegistry()
  return (chainId: string) => {
    const chain = chains.find((chain) => chain.chain_id === chainId)
    if (chain) return chain

    // Fallback to profiles.json for chains not found from Skip
    const profile = profiles.find((profile) => profile.chain_id === chainId)
    if (!profile) throw new Error(`Chain not found: ${chainId}`)

    // Return a minimal RouterChainJson object with display metadata from profile
    return {
      chain_id: profile.chain_id,
      chain_name: profile.name,
      pretty_name: profile.pretty_name,
      logo_uri: profile.logo,
      chain_type: "cosmos",
      rpc: "",
      rest: "",
    } as RouterChainJson
  }
}

export function useSkipChain(chainId: string) {
  const findSkipChain = useFindSkipChain()
  return findSkipChain(chainId)
}
