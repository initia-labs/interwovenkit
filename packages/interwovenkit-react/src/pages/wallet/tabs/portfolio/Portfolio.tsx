import { useMemo } from "react"
import { useAtom } from "jotai"
import AsyncBoundary from "@/components/AsyncBoundary"
import FallBack from "@/components/FallBack"
import Skeleton from "@/components/Skeleton"
import { useLayer1 } from "@/data/chains"
import { useConfig } from "@/data/config"
import { useMinityChainBreakdown } from "@/data/minity"
import { formatValue } from "@/lib/format"
import ChainSelect from "../../components/ChainSelect"
import HomeContainer from "../../components/HomeContainer"
import { portfolioChainAtom, portfolioSearchAtom } from "../state"
import Assets from "./Assets"
import Positions from "./Positions"
import styles from "./Portfolio.module.css"

/**
 * ChainSelectWithData - fetches chain breakdown data for ChainSelect.
 * Isolated in its own AsyncBoundary so search input renders immediately.
 */
const ChainSelectWithData = ({
  selectedChain,
  setSelectedChain,
}: {
  selectedChain: string
  setSelectedChain: (chain: string) => void
}) => {
  const { defaultChainId } = useConfig()
  const layer1 = useLayer1()
  const chainBreakdown = useMinityChainBreakdown()

  // Derive chainIds and value map from chainBreakdown (single data source)
  // Sort: connected chain first, then Initia (L1), then by value descending
  const { chainIds, chainIdToValueMap, totalBalance } = useMemo(() => {
    const valueMap = new Map<string, number>()
    let total = 0

    for (const chain of chainBreakdown) {
      valueMap.set(chain.chainId, chain.totalBalance)
      total += chain.totalBalance
    }

    // Sort chainIds: connected chain first, then L1, then by value
    const sortedIds = chainBreakdown
      .map((chain) => chain.chainId)
      .toSorted((a, b) => {
        // Connected chain first
        if (a === defaultChainId) return -1
        if (b === defaultChainId) return 1
        // Then Initia (L1)
        if (a === layer1.chainId) return -1
        if (b === layer1.chainId) return 1
        // Then by value descending
        return (valueMap.get(b) ?? 0) - (valueMap.get(a) ?? 0)
      })

    return { chainIds: sortedIds, chainIdToValueMap: valueMap, totalBalance: total }
  }, [chainBreakdown, defaultChainId, layer1])

  return (
    <ChainSelect
      value={selectedChain}
      onChange={setSelectedChain}
      chainIds={chainIds}
      renderExtra={(chainId) => {
        if (!chainId) return formatValue(totalBalance)
        return formatValue(chainIdToValueMap.get(chainId) ?? 0)
      }}
    />
  )
}

const Portfolio = () => {
  const [searchQuery, setSearchQuery] = useAtom(portfolioSearchAtom)
  const [selectedChain, setSelectedChain] = useAtom(portfolioChainAtom)

  return (
    <HomeContainer.Root>
      <HomeContainer.Controls>
        <HomeContainer.SearchInput
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onClear={() => setSearchQuery("")}
          placeholder="Search portfolio"
        />
        <AsyncBoundary suspenseFallback={<Skeleton height={44} width={132} />}>
          <ChainSelectWithData selectedChain={selectedChain} setSelectedChain={setSelectedChain} />
        </AsyncBoundary>
      </HomeContainer.Controls>

      <div className={styles.content}>
        <AsyncBoundary suspenseFallback={<FallBack height={48} length={5} />}>
          <Assets searchQuery={searchQuery} selectedChain={selectedChain} />
        </AsyncBoundary>
        <AsyncBoundary suspenseFallback={<FallBack height={56} length={3} />}>
          <Positions searchQuery={searchQuery} selectedChain={selectedChain} />
        </AsyncBoundary>
      </div>
    </HomeContainer.Root>
  )
}

export default Portfolio
