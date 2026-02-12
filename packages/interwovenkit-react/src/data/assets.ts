import ky from "ky"
import { head } from "ramda"
import {
  queryOptions,
  useQueries,
  useQueryClient,
  useSuspenseQueries,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import type { Asset, AssetList } from "@initia/initia-registry-types"
import { getIbcDenom } from "@initia/utils"
import type { BaseAsset } from "@/components/form/types"
import type { NormalizedChain } from "./chains"
import { useInitiaRegistry, useLayer1 } from "./chains"
import { STALE_TIMES } from "./http"
import placeholder from "./placeholder"

export const assetQueryKeys = createQueryKeys("interwovenkit:asset", {
  list: (assetlistUrl?: string) => [assetlistUrl],
  item: (chainId: string, denom: string) => [chainId, denom],
  resource: (chain: NormalizedChain, asset: NormalizedAsset) => [chain.chainId, asset.denom],
  denom: (restUrl: string, metadata: string) => [restUrl, metadata],
  metadata: (restUrl: string, denom: string) => [restUrl, denom],
})

export interface NormalizedAsset extends BaseAsset {
  address?: string
  traces?: Asset["traces"]
}

function normalizeAsset(asset: Asset): NormalizedAsset {
  const { base: denom, symbol, denom_units = [], display, logo_URIs, name, address, traces } = asset
  const decimals =
    denom_units.find((unit) => unit.denom === display)?.exponent ??
    denom_units.find((unit) => unit.denom === denom)?.exponent ??
    head(denom_units)?.exponent ??
    0
  const logoUrl = logo_URIs?.png ?? ""
  return { denom, symbol, decimals, logoUrl, name, address, traces }
}

function useCreateAssetsQuery() {
  const queryClient = useQueryClient()

  return (chain?: NormalizedChain) => {
    const assetlistUrl = chain?.metadata?.assetlist

    return queryOptions({
      queryKey: assetQueryKeys.list(assetlistUrl).queryKey,
      queryFn: async () => {
        if (!assetlistUrl) return { assets: [] as Asset[] } as AssetList
        return ky.get(assetlistUrl).json<AssetList>()
      },
      select: ({ assets }: AssetList) => {
        if (!chain) return []
        const normalizedAssets = assets.map(normalizeAsset)
        for (const asset of normalizedAssets) {
          queryClient.setQueryData(assetQueryKeys.item(chain.chainId, asset.denom).queryKey, asset)
        }
        return normalizedAssets
      },
      staleTime: STALE_TIMES.MINUTE,
    })
  }
}

export function useAssets(chain?: NormalizedChain) {
  const createAssetsQuery = useCreateAssetsQuery()
  const { data } = useSuspenseQuery(createAssetsQuery(chain))
  return data
}

export function useAllChainsAssetsQueries() {
  const chains = useInitiaRegistry()
  const createAssetsQuery = useCreateAssetsQuery()
  return useQueries({
    queries: chains.map((chain) => createAssetsQuery(chain)),
  })
}

export function useFindAsset(chain: NormalizedChain) {
  const assets = useAssets(chain)
  const layer1 = useLayer1()
  const layer1Assets = useAssets(layer1)
  const getLayer1Denom = useGetLayer1Denom(chain)
  return (denom: string) => {
    const asset = assets.find((asset) => asset.denom === denom)
    if (asset) return asset
    const layer1Asset = layer1Assets.find((asset) => asset.denom === getLayer1Denom(denom))
    if (layer1Asset) return { ...layer1Asset, denom }
    return { denom, symbol: "", decimals: 0, logoUrl: placeholder }
  }
}

export function useAsset(denom: string, chain: NormalizedChain) {
  const findAsset = useFindAsset(chain)
  const queryClient = useQueryClient()
  const cachedAsset = queryClient.getQueryData<NormalizedAsset>(
    assetQueryKeys.item(chain.chainId, denom).queryKey,
  )
  if (cachedAsset) return cachedAsset
  return findAsset(denom)
}

export function findAssetByCounterpartyDenom(
  assets: NormalizedAsset[],
  chain: NormalizedChain,
  denom: string,
) {
  return assets.find((asset) =>
    asset.traces?.some((trace) => {
      const { counterparty } = trace
      const belongsToChain =
        counterparty.chain_id === chain.chain_id || counterparty.chain_name === chain.chain_name
      return belongsToChain && counterparty.base_denom === denom
    }),
  )
}

export function useGetLayer1Denom(chain: NormalizedChain) {
  const layer1 = useLayer1()
  const assets = useAssets(chain)

  return (denom: string) => {
    if (chain.metadata?.is_l1) {
      return denom
    }

    if (denom.startsWith("l2/") || denom.startsWith("ibc/")) {
      const asset =
        assets.find((asset) => asset.denom === denom) ??
        findAssetByCounterpartyDenom(assets, chain, denom)
      if (asset?.traces) {
        for (const trace of asset.traces) {
          if (trace.counterparty.chain_name === layer1.chain_name) {
            return trace.counterparty.base_denom
          }
        }
      }
    }

    const ibcChannelToL2 = layer1.metadata?.ibc_channels?.find(
      ({ chain_id, version }) => chain_id === chain.chain_id && version === "ics20-1",
    )?.channel_id

    if (ibcChannelToL2) {
      return getIbcDenom(ibcChannelToL2, denom)
    }

    return ""
  }
}

/**
 * Fetches denom from metadata addresses using the Move denom API.
 * Returns a Map of metadata -> denom.
 */
export function useDenoms(metadatas: string[]) {
  const layer1 = useLayer1()
  const restClient = ky.create({ prefixUrl: layer1.restUrl })

  const result = useSuspenseQueries({
    queries: metadatas.map((metadata) => ({
      queryFn: () =>
        restClient
          .get("initia/move/v1/denom", { searchParams: { metadata } })
          .json<{ denom: string }>(),
      queryKey: assetQueryKeys.denom(layer1.restUrl, metadata).queryKey,
      select: (data: { denom: string }): [string, string] => [metadata, data.denom],
      staleTime: STALE_TIMES.INFINITY,
    })),
  })

  return new Map(result.map(({ data }) => data!))
}
