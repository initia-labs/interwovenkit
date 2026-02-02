import { descend, sortWith } from "ramda"
import { useMemo } from "react"
import { useAtom } from "jotai"
import AsyncBoundary from "@/components/AsyncBoundary"
import Skeleton from "@/components/Skeleton"
import Skeletons from "@/components/Skeletons"
import { useAllChainsAssetsQueries } from "@/data/assets"
import { useAllChainPriceQueries, useInitiaRegistry, useLayer1 } from "@/data/chains"
import { useConfig } from "@/data/config"
import { useInitiaVipPositions } from "@/data/initia-vip"
import {
  buildAssetLogoMaps,
  buildPriceMap,
  useChainInfoMap,
  useMinityChainBreakdown,
} from "@/data/minity"
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
  const { totalValue: vipTotalValue } = useInitiaVipPositions()

  // Derive chainIds and value map from chainBreakdown (single data source)
  // Sort: connected chain first, then Initia (L1), then by value descending
  const { chainIds, chainIdToValueMap, totalBalance } = useMemo(() => {
    const valueMap = new Map<string, number>()
    let total = 0

    for (const chain of chainBreakdown) {
      valueMap.set(chain.chainId, chain.totalBalance)
      total += chain.totalBalance
    }

    // Add VIP reward value to Initia (L1) chain and total
    if (vipTotalValue > 0) {
      valueMap.set(layer1.chainId, (valueMap.get(layer1.chainId) ?? 0) + vipTotalValue)
      total += vipTotalValue
    }

    // Sort chainIds: connected chain first, then L1, then by value descending
    const sortedIds = sortWith(
      [
        descend((chainId: string) => chainId === defaultChainId),
        descend((chainId: string) => chainId === layer1.chainId),
        descend((chainId: string) => valueMap.get(chainId) ?? 0),
      ],
      chainBreakdown.map((chain) => chain.chainId),
    )

    return { chainIds: sortedIds, chainIdToValueMap: valueMap, totalBalance: total }
  }, [chainBreakdown, defaultChainId, layer1, vipTotalValue])

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

  // Fetch chains for price queries
  const chains = useInitiaRegistry()

  // Fetch asset logos once at portfolio level (shared by Assets and Positions)
  // This prevents re-fetching on every search keystroke
  const assetsQueries = useAllChainsAssetsQueries()
  const { denomLogos, symbolLogos } = useMemo(
    () => buildAssetLogoMaps(assetsQueries),
    [assetsQueries],
  )

  // Fetch prices for all chains once at portfolio level (used for fallback pricing)
  // This prevents re-fetching on every search keystroke
  const priceQueries = useAllChainPriceQueries()
  const chainPrices = useMemo(() => buildPriceMap(chains, priceQueries), [chains, priceQueries])

  // Fetch chain info map once at portfolio level (used by Assets and Positions)
  // This prevents suspension when search filter changes
  const chainInfoMap = useChainInfoMap()

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
        <AsyncBoundary suspenseFallback={<Skeletons height={48} length={5} />}>
          <Assets
            searchQuery={searchQuery}
            selectedChain={selectedChain}
            denomLogos={denomLogos}
            symbolLogos={symbolLogos}
            chainInfoMap={chainInfoMap}
            chainPrices={chainPrices}
          />
        </AsyncBoundary>
        <AsyncBoundary suspenseFallback={<Skeletons height={56} length={3} />}>
          <Positions
            searchQuery={searchQuery}
            selectedChain={selectedChain}
            chainInfoMap={chainInfoMap}
          />
        </AsyncBoundary>
      </div>
    </HomeContainer.Root>
  )
}

export default Portfolio
