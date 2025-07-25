import ky from "ky"
import { head } from "ramda"
import { toBytes } from "@noble/hashes/utils"
import { sha256 } from "@noble/hashes/sha2"
import { sha3_256 } from "@noble/hashes/sha3"
import { toHex } from "@cosmjs/encoding"
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import type { Asset, AssetList } from "@initia/initia-registry-types"
import { AddressUtils } from "@/public/utils"
import type { BaseAsset } from "@/components/form/types"
import { STALE_TIMES } from "./http"
import type { NormalizedChain } from "./chains"
import { useLayer1 } from "./chains"
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

/**
 * NOTE:
 *
 * We currently load asset metadata (e.g. symbol, decimals) primarily from `assetlist.json`,
 * regardless of the user's balance.
 *
 * If an asset is not found in the list — especially on Move-based chains — we fall back to
 * fetching its info from on-chain Move resources. However, this fallback is only possible
 * after we detect the user's balance for that asset.
 *
 * Because of this, we first fetch from the asset list for all assets, and later query
 * Move resources only for the assets that appear in the user's balance but are missing metadata.
 *
 * This structure is not perfect. A future improvement might be to query all assets individually,
 * cache the result into queryClient, and always read asset metadata from there.
 */
export function useAssets(chain?: NormalizedChain) {
  const assetlistUrl = chain?.metadata?.assetlist
  const queryClient = useQueryClient()
  const { data } = useSuspenseQuery({
    queryKey: assetQueryKeys.list(assetlistUrl).queryKey,
    queryFn: async () => {
      if (!assetlistUrl) return { assets: [] as Asset[] }
      return ky.get(assetlistUrl).json<AssetList>()
    },
    select: ({ assets }) => {
      if (!chain) return []
      const normalizedAssets = assets.map(normalizeAsset)
      for (const asset of normalizedAssets) {
        queryClient.setQueryData(assetQueryKeys.item(chain.chainId, asset.denom).queryKey, asset)
      }
      return normalizedAssets
    },
    staleTime: STALE_TIMES.MINUTE,
  })
  return data
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

export function useGetLayer1Denom(chain: NormalizedChain) {
  const layer1 = useLayer1()
  const assets = useAssets(chain)

  return (denom: string) => {
    if (chain.metadata?.is_l1) {
      return denom
    }

    if (denom.startsWith("l2/") || denom.startsWith("ibc/")) {
      const traces = assets.find((asset) => asset.denom === denom)?.traces
      if (traces) {
        for (const trace of traces) {
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
      return getIBCDenom(ibcChannelToL2, denom)
    }

    return ""
  }
}

export function generateDerivedAddress(owner: string, metadata: string) {
  const OBJECT_DERIVED_SCHEME = 0xfc
  const ownerBytes = AddressUtils.toBytes(owner, 32)
  const metadataBytes = AddressUtils.toBytes(metadata, 32)
  const bytes = new Uint8Array([...ownerBytes, ...metadataBytes, OBJECT_DERIVED_SCHEME])
  return toHex(sha3_256.create().update(bytes).digest())
}

export function generateSeededAddress(creator: string, symbol: string) {
  const OBJECT_FROM_SEED_ADDRESS_SCHEME = 0xfe
  const creatorBytes = AddressUtils.toBytes(creator, 32)
  const seed = toBytes(symbol)
  const bytes = new Uint8Array([...creatorBytes, ...seed, OBJECT_FROM_SEED_ADDRESS_SCHEME])
  return toHex(sha3_256.create().update(bytes).digest())
}

export function denomToMetadata(denom: string) {
  if (!denom) return ""
  if (denom.startsWith("move/")) return `0x${denom.slice(5)}`
  return `0x${generateSeededAddress("0x1", denom)}`
}

export function getIBCDenom(channelId: string, denom: string) {
  const path = `transfer/${channelId}/${denom}`
  return `ibc/${toHex(sha256(path)).toUpperCase()}`
}
