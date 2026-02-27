import type { BalanceResponseDenomEntryJson } from "@skip-go/client"
import BigNumber from "bignumber.js"
import { useMemo } from "react"
import Skeleton from "@/components/Skeleton"
import AssetResultRow from "./AssetResultRow"
import ResultSection from "./ResultSection"
import { useFlatAssets } from "./useFlatAssets"
import styles from "./YourAssets.module.css"

type BalanceMap = Record<string, Record<string, BalanceResponseDenomEntryJson>>

interface Props {
  balanceMap: BalanceMap
  isLoading: boolean
  onSelect: (chainId: string, denom: string) => void
}

const SKELETON_COUNT = 3

const YourAssets = ({ balanceMap, isLoading, onSelect }: Props) => {
  const flatAssets = useFlatAssets()

  const items = useMemo(() => {
    return flatAssets
      .filter((a) => {
        const bal = balanceMap[a.chainId]?.[a.denom]
        return bal && BigNumber(bal.value_usd ?? 0).gt(0)
      })
      .sort((a, b) => {
        const aValue = BigNumber(balanceMap[a.chainId]?.[a.denom]?.value_usd ?? 0)
        const bValue = BigNumber(balanceMap[b.chainId]?.[b.denom]?.value_usd ?? 0)
        return bValue.comparedTo(aValue) ?? 0
      })
  }, [flatAssets, balanceMap])

  if (!isLoading && items.length === 0) return null

  return (
    <ResultSection label="Your assets">
      {isLoading && items.length === 0 ? (
        Array.from({ length: SKELETON_COUNT }, (_, i) => (
          <div key={i} className={styles.skeletonRow}>
            <div className={styles.skeletonIcon}>
              <Skeleton width={28} height={28} />
            </div>
            <div className={styles.skeletonText}>
              <Skeleton width={80} height={14} />
              <Skeleton width={120} height={12} />
            </div>
          </div>
        ))
      ) : (
        <div className={styles.loaded}>
          {items.map((asset) => (
            <AssetResultRow
              key={`${asset.chainId}-${asset.denom}`}
              asset={asset}
              balance={balanceMap[asset.chainId]?.[asset.denom]}
              highlighted={false}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </ResultSection>
  )
}

export default YourAssets
