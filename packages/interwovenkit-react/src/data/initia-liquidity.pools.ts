import ky from "ky"
import { useMemo } from "react"
import { useSuspenseQueries } from "@tanstack/react-query"
import { denomToMetadata } from "@initia/utils"
import { useAssets } from "./assets"
import { useLayer1 } from "./chains"
import { useConfig } from "./config"
import { OMNI_INIT_DENOM, OMNI_INIT_SYMBOL } from "./constants"
import { STALE_TIMES } from "./http"
import { initiaLiquidityQueryKeys } from "./initia-liquidity.query-keys"
import type { PoolResponse } from "./initia-liquidity.types"

function useLiquidityPoolsByMetadata(metadatas: string[]): Map<string, PoolResponse | null> {
  const { dexUrl } = useConfig()

  const queries = useSuspenseQueries({
    queries: metadatas.map((metadata) => ({
      queryKey: initiaLiquidityQueryKeys.poolByMetadata(dexUrl, metadata).queryKey,
      queryFn: async () => {
        try {
          const response = await ky
            .get(`${dexUrl}/indexer/dex/v2/pools/${encodeURIComponent(metadata)}`)
            .json<{ pool: PoolResponse }>()
          return response.pool
        } catch {
          return null
        }
      },
      staleTime: STALE_TIMES.MINUTE,
    })),
  })

  const queryData = queries.map((query) => query.data)

  return useMemo(() => {
    const map = new Map<string, PoolResponse | null>()

    metadatas.forEach((metadata, i) => {
      map.set(metadata, queryData[i] ?? null)
    })

    return map
  }, [metadatas, queryData])
}

export function getCoinLogos(
  pool: PoolResponse | null,
  assetByDenom: Map<string, { logoUrl?: string }>,
): string[] {
  if (!pool?.coins || pool.coins.length === 0) return []

  return pool.coins.map((coin) => {
    const asset = assetByDenom.get(coin.denom)
    return asset?.logoUrl || ""
  })
}

export function useLiquidityPoolByMetadataList(
  metadatas: string[],
): Map<string, PoolResponse | null> {
  return useLiquidityPoolsByMetadata(metadatas)
}

/** Fetch pool info for multiple LP tokens */
export function useLiquidityPoolList(denoms: string[]): Map<string, PoolResponse | null> {
  const layer1 = useLayer1()
  const assets = useAssets(layer1)

  const assetByDenom = useMemo(() => {
    const map = new Map<string, { symbol?: string }>()

    for (const asset of assets) {
      map.set(asset.denom, asset)
    }

    return map
  }, [assets])

  const metadataList = useMemo(() => denoms.map((denom) => denomToMetadata(denom)), [denoms])
  const poolsByMetadata = useLiquidityPoolsByMetadata(metadataList)

  return useMemo(() => {
    const map = new Map<string, PoolResponse | null>()

    denoms.forEach((denom, i) => {
      const metadata = metadataList[i]
      if (!metadata) {
        map.set(denom, null)
        return
      }

      const pool = poolsByMetadata.get(metadata)
      if (!pool) {
        map.set(denom, null)
        return
      }

      if (denom === OMNI_INIT_DENOM) {
        map.set(denom, { ...pool, symbol: OMNI_INIT_SYMBOL })
        return
      }

      const symbol = pool.coins
        .map((coin) => {
          const asset = assetByDenom.get(coin.denom)
          return asset?.symbol || coin.denom
        })
        .join("-")

      map.set(denom, { ...pool, symbol })
    })

    return map
  }, [denoms, metadataList, poolsByMetadata, assetByDenom])
}
