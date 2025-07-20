import ky from "ky"
import { descend, path, uniq } from "ramda"
import { useAtom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import type { Chain, SecureEndpoint } from "@initia/initia-registry-types"
import { LocalStorageKey } from "./constants"
import { useConfig } from "./config"
import { STALE_TIMES } from "./http"

export const chainQueryKeys = createQueryKeys("interwovenkit:chain", {
  list: (registryUrl: string) => [registryUrl],
  prices: (chainId: string) => [chainId],
  gasPrices: (chain: NormalizedChain) => [chain],
})

const addedChainIdsAtom = atomWithStorage<string[]>(LocalStorageKey.ADDED_CHAIN_IDS, [])

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

export function usePricesQuery(chainId: string) {
  return useQuery({
    queryKey: chainQueryKeys.prices(chainId).queryKey,
    queryFn: () =>
      ky
        .create({ prefixUrl: "https://celatone-api-prod.alleslabs.dev" })
        .get(`v1/initia/${chainId}/assets`, { searchParams: { with_prices: true } })
        .json<{ id: string; price: number }[]>(),
    staleTime: STALE_TIMES.SECOND,
  })
}

export function useManageChains() {
  const chains = useInitiaRegistry()
  const { defaultChainId } = useConfig()
  const [addedChainIds, setAddedChainIds] = useAtom(addedChainIdsAtom)

  const withDefaultChainID = (chainIds: string[]) => {
    return uniq([defaultChainId, ...chainIds])
  }

  const addedChains = withDefaultChainID(addedChainIds)
    .map((chainId) => chains.find((chain) => chain.chainId === chainId))
    .filter(Boolean) as NormalizedChain[]

  const notAddedChains = chains.filter(
    (chain) => !withDefaultChainID(addedChainIds).includes(chain.chainId),
  )

  const addChain = (chainId: string) => {
    setAddedChainIds((prev) => withDefaultChainID([...prev, chainId]))
  }

  const removeChain = (chainId: string) => {
    setAddedChainIds((prev) => withDefaultChainID(prev.filter((id) => id !== chainId)))
  }

  return { chains, addedChains, notAddedChains, addChain, removeChain }
}
