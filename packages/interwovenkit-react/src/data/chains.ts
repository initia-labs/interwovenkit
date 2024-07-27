import ky from "ky"
import { descend, path } from "ramda"
import { queryOptions, useQueries, useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import type { Chain, SecureEndpoint } from "@initia/initia-registry-types"
import { useConfig } from "./config"
import { STALE_TIMES } from "./http"

export const chainQueryKeys = createQueryKeys("interwovenkit:chain", {
  list: (registryUrl: string) => [registryUrl],
  prices: (chainId: string) => [chainId],
  gasPrices: (chain: NormalizedChain) => [chain],
})

function getPrimaryEndpoint(endpoints?: SecureEndpoint[]) {
  const url = path<string>([0, "address"], endpoints)
  if (!url) throw new Error("URL not found")
  return url
}

function normalizeChain(chain: Chain) {
  const { chain_id: chainId, chain_name, pretty_name, logo_URIs, apis, metadata } = chain
  const name = pretty_name || chain_name
  const logoUrl = logo_URIs?.png ?? ""
  const { rpc, rest, api, ["json-rpc"]: jsonRpc } = apis
  const rpcUrl = getPrimaryEndpoint(rpc)
  const restUrl = getPrimaryEndpoint(rest)
  const indexerUrl = metadata?.is_l1 ? getPrimaryEndpoint(api) : restUrl
  const jsonRpcUrl = metadata?.minitia?.type === "minievm" ? getPrimaryEndpoint(jsonRpc) : undefined
  return { ...chain, chainId, name, logoUrl, rpcUrl, restUrl, indexerUrl, jsonRpcUrl }
}

export type NormalizedChain = ReturnType<typeof normalizeChain>

export function useInitiaRegistry() {
  const { defaultChainId, registryUrl, customChain } = useConfig()
  const { data } = useSuspenseQuery({
    queryKey: chainQueryKeys.list(registryUrl).queryKey,
    queryFn: () => ky.create({ prefixUrl: registryUrl }).get("chains.json").json<Chain[]>(),
    select: (rawChains) => {
      const chains = customChain
        ? [customChain, ...rawChains.filter((chain) => chain.chain_id !== customChain.chain_id)]
        : rawChains
      return chains
        .map(normalizeChain)
        .toSorted(descend((chain) => chain.chainId === defaultChainId))
    },
    staleTime: STALE_TIMES.MINUTE,
  })
  return data
}

export function useFindChain() {
  const chains = useInitiaRegistry()
  return (chainId: string) => {
    const chain = chains.find((chain) => chain.chain_id === chainId)
    if (!chain) throw new Error(`Chain not found: ${chainId}`)
    return chain
  }
}

export function useChain(chainId: string) {
  const findChain = useFindChain()
  return findChain(chainId)
}

export function useDefaultChain() {
  const { defaultChainId } = useConfig()
  return useChain(defaultChainId)
}

export function useLayer1() {
  const chains = useInitiaRegistry()
  const chain = chains.find((chain) => chain.metadata?.is_l1)
  if (!chain) throw new Error("Layer 1 not found")
  return chain
}

export interface PriceItem {
  id: string
  price: number
}

function useCreatePricesQuery() {
  return ({ chainId }: NormalizedChain) => {
    return queryOptions({
      queryKey: chainQueryKeys.prices(chainId).queryKey,
      queryFn: () =>
        ky
          .create({ prefixUrl: "https://api.initia.xyz" })
          .get(`initia/${chainId}/assets`, { searchParams: { quote: "USD", with_prices: true } })
          .json<PriceItem[]>(),
      staleTime: STALE_TIMES.SECOND,
    })
  }
}

export function usePricesQuery(chain: NormalizedChain) {
  const createPricesQuery = useCreatePricesQuery()
  return useQuery(createPricesQuery(chain))
}

export function useAllChainPriceQueries() {
  const chains = useInitiaRegistry()
  const createPricesQuery = useCreatePricesQuery()
  return useQueries({
    queries: chains.map((chain) => createPricesQuery(chain)),
  })
}
