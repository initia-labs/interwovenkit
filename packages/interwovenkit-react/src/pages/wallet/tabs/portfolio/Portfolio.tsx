import { useMemo } from "react"
import { useAtom } from "jotai"
import { useMinityChainBreakdown, useMinityPortfolioTotals } from "@/data/minity"
import { formatValue } from "@/lib/format"
import ChainSelect from "../../components/ChainSelect"
import HomeContainer from "../../components/HomeContainer"
import { portfolioChainAtom, portfolioSearchAtom } from "../state"
import Assets from "./Assets"
import Positions from "./Positions"
import styles from "./Portfolio.module.css"

const Portfolio = () => {
  const [searchQuery, setSearchQuery] = useAtom(portfolioSearchAtom)
  const [selectedChain, setSelectedChain] = useAtom(portfolioChainAtom)

  // Minity data for chain breakdown and total value
  const { data: chainBreakdown } = useMinityChainBreakdown()
  const {
    data: { totalBalance },
  } = useMinityPortfolioTotals()

  // Build chainIds list from chain breakdown (for ChainSelect)
  const chainIds = useMemo(() => {
    return chainBreakdown.map((chain) => chain.chainId)
  }, [chainBreakdown])

  // Build chainId -> value map for renderExtra
  const chainIdToValueMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const chain of chainBreakdown) {
      map.set(chain.chainId, chain.totalBalance)
    }
    return map
  }, [chainBreakdown])

  return (
    <HomeContainer.Root>
      <HomeContainer.Controls>
        <HomeContainer.SearchInput
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onClear={() => setSearchQuery("")}
          placeholder="Search portfolio"
        />
        <ChainSelect
          value={selectedChain}
          onChange={setSelectedChain}
          chainIds={chainIds}
          renderExtra={(chainId) => {
            // Show total value for "All" option (empty chainId)
            if (!chainId) return formatValue(totalBalance)
            return formatValue(chainIdToValueMap.get(chainId) ?? 0)
          }}
        />
      </HomeContainer.Controls>

      <div className={styles.content}>
        <Assets searchQuery={searchQuery} selectedChain={selectedChain} />
        <Positions searchQuery={searchQuery} selectedChain={selectedChain} />
      </div>
    </HomeContainer.Root>
  )
}

export default Portfolio
