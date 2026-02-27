import { IconArrowRight } from "@initia/icons-react"
import Images from "@/components/Images"
import type { RouterAsset } from "../data/assets"
import { useAllSkipAssetsRaw } from "../data/assets"
import type { RouterChainJson } from "../data/chains"
import { useFindSkipChain } from "../data/chains"
import type { RecentPair } from "./types"
import styles from "./RecentPairs.module.css"

interface Props {
  pairs: RecentPair[]
  onSelectPair: (pair: RecentPair) => void
}

interface PairRow {
  key: string
  pair: RecentPair
  srcChain: RouterChainJson
  dstChain: RouterChainJson
  srcAsset: RouterAsset
  dstAsset: RouterAsset
}

function getPairKey(pair: RecentPair): string {
  return `${pair.srcChainId}:${pair.srcDenom}->${pair.dstChainId}:${pair.dstDenom}`
}

const RecentPairs = ({ pairs, onSelectPair }: Props) => {
  const findChain = useFindSkipChain()
  const {
    data: { chain_to_assets_map },
  } = useAllSkipAssetsRaw()

  const rows = pairs.reduce<PairRow[]>((result, pair) => {
    const srcChain = findChain(pair.srcChainId)
    const dstChain = findChain(pair.dstChainId)
    const srcAsset = chain_to_assets_map[pair.srcChainId]?.assets?.find(
      (asset) => asset.denom === pair.srcDenom,
    )
    const dstAsset = chain_to_assets_map[pair.dstChainId]?.assets?.find(
      (asset) => asset.denom === pair.dstDenom,
    )

    if (!srcAsset || !dstAsset) return result

    result.push({ key: getPairKey(pair), pair, srcChain, dstChain, srcAsset, dstAsset })
    return result
  }, [])

  if (rows.length === 0) return null

  return (
    <div className={styles.container}>
      <h3 className={styles.label}>Recent</h3>
      {rows.map(({ key, pair, srcChain, dstChain, srcAsset, dstAsset }) => (
        <button
          type="button"
          className={styles.item}
          onClick={() => onSelectPair(pair)}
          key={key}
          data-search-item
        >
          <Images
            assetLogoUrl={srcAsset.logo_uri ?? undefined}
            assetLogoSize={24}
            chainLogoUrl={srcChain.logo_uri ?? undefined}
            chainLogoSize={12}
          />
          <span className={styles.symbol}>{srcAsset.symbol}</span>

          <IconArrowRight size={12} className={styles.arrow} />

          <Images
            assetLogoUrl={dstAsset.logo_uri ?? undefined}
            assetLogoSize={24}
            chainLogoUrl={dstChain.logo_uri ?? undefined}
            chainLogoSize={12}
          />
          <span className={styles.symbol}>{dstAsset.symbol}</span>
        </button>
      ))}
    </div>
  )
}

export default RecentPairs
