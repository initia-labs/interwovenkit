import { useMemo, useState } from "react"
import Image from "@/components/Image"
import { useBridgeConfig } from "../data/bridgeConfig"
import { useSkipChains } from "../data/chains"
import styles from "./ChainBar.module.css"

const COLLAPSED_COUNT = 8

interface Props {
  onSelect: (chainId: string) => void
}

const ChainBar = ({ onSelect }: Props) => {
  const allChains = useSkipChains()
  const { pinnedChainIds } = useBridgeConfig()
  const [expanded, setExpanded] = useState(false)

  const visibleChains = useMemo(() => {
    const visible = allChains.filter((c) => !c.hidden)
    if (!pinnedChainIds.length) return visible

    const chainMap = new Map(visible.map((c) => [c.chain_id, c]))
    const pinned = Array.from(new Set(pinnedChainIds)).flatMap((id) => {
      const chain = chainMap.get(id)
      return chain ? [chain] : []
    })
    const pinnedChainIdSet = new Set(pinned.map((chain) => chain.chain_id))
    const remaining = visible.filter((c) => !pinnedChainIdSet.has(c.chain_id))
    return [...pinned, ...remaining]
  }, [allChains, pinnedChainIds])

  const hasOverflow = visibleChains.length > COLLAPSED_COUNT
  const displayed = expanded ? visibleChains : visibleChains.slice(0, COLLAPSED_COUNT)
  const remainingCount = visibleChains.length - COLLAPSED_COUNT

  return (
    <div className={styles.section}>
      <span className={styles.label}>Chains</span>
      <div className={styles.chips}>
        {displayed.map((chain) => (
          <button
            key={chain.chain_id}
            type="button"
            className={styles.chip}
            onClick={() => onSelect(chain.chain_id)}
          >
            <Image src={chain.logo_uri ?? undefined} width={18} height={18} logo />
            <span className={styles.name}>{chain.pretty_name || chain.chain_name}</span>
          </button>
        ))}
        {hasOverflow && !expanded && (
          <button type="button" className={styles.moreChip} onClick={() => setExpanded(true)}>
            +{remainingCount} more
          </button>
        )}
      </div>
    </div>
  )
}

export default ChainBar
