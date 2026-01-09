import { memo, useMemo } from "react"
import AsyncBoundary from "@/components/AsyncBoundary"
import FallBack from "@/components/FallBack"
import Status from "@/components/Status"
import { useLayer1 } from "@/data/chains"
import { useCivitiaPlayer } from "@/data/civitia"
import {
  type ChainInfo,
  getPositionValue,
  type PortfolioChainPositionGroup,
  useMinityPortfolio,
} from "@/data/minity"
import AppchainPositionGroup from "./AppchainPositionGroup"
import InitiaPositionGroup from "./InitiaPositionGroup"
import PositionsTotalValue from "./PositionsTotalValue"
import styles from "./Positions.module.css"

export interface PositionsProps {
  searchQuery: string
  selectedChain: string
  chainInfoMap: Map<string, ChainInfo>
}

const Positions = memo(({ searchQuery, selectedChain, chainInfoMap }: PositionsProps) => {
  // Position data (SSE - streams progressively)
  const { positions, isLoading } = useMinityPortfolio()

  // Layer 1 chain info
  const layer1 = useLayer1()

  // Civitia player data
  const { data: civitiaPlayer, isLoading: isCivitiaPlayerLoading } = useCivitiaPlayer()

  // Filter and transform positions into chain groups
  const filteredChainGroups = useMemo(() => {
    const result: PortfolioChainPositionGroup[] = []

    for (const chainData of positions) {
      // Skip if positions is not an array
      if (!Array.isArray(chainData.positions)) continue

      // Get chain info from breakdown
      const chainInfo = chainInfoMap.get(chainData.chainName.toLowerCase())
      const chainNameLower = chainData.chainName.toLowerCase()
      const isCivitiaChain = chainNameLower === "civitia"

      // Filter by selected chain (using chainId)
      if (selectedChain && chainInfo?.chainId !== selectedChain) {
        continue
      }

      // Check if chain has any actual renderable positions (not fungible positions)
      const hasAnyPositions = chainData.positions.some((protocol) =>
        protocol.positions.some((pos) => pos.type !== "fungible-position"),
      )

      // For Civitia specifically, also check if user has gold or silver
      // Skip Civitia check if still loading player data
      const hasCivitiaGoldOrSilver =
        isCivitiaChain &&
        !isCivitiaPlayerLoading &&
        civitiaPlayer &&
        ((civitiaPlayer.gold_balance ?? 0) > 0 || (civitiaPlayer.silver_balance ?? 0) > 0)

      // Skip chain if it has no displayable content
      if (!hasAnyPositions && !hasCivitiaGoldOrSilver) {
        continue
      }

      // Skip chain if search query doesn't match chain name
      if (searchQuery && !chainNameLower.includes(searchQuery.toLowerCase())) {
        continue
      }

      // Filter protocols by search query (match protocol name)
      const filteredProtocols = chainData.positions.filter((protocol) => {
        if (searchQuery && !protocol.protocol.toLowerCase().includes(searchQuery.toLowerCase())) {
          return false
        }
        return Array.isArray(protocol.positions) && protocol.positions.length > 0
      })

      const isInitia = layer1.chainId === chainInfo?.chainId

      // Calculate total value for this chain
      const totalValue = filteredProtocols.reduce((sum, protocol) => {
        return sum + protocol.positions.reduce((posSum, pos) => posSum + getPositionValue(pos), 0)
      }, 0)

      result.push({
        chainName: chainInfo?.prettyName ?? chainData.chainName,
        chainLogo: chainInfo?.logoUrl ?? "",
        protocols: filteredProtocols,
        isInitia,
        totalValue,
      })
    }

    // Chains excluded from value calculations (fungible NFTs only, no USD values)
    const excludedChains = ["civitia", "yominet"]

    // Sort: Initia first, then by value descending, then excluded chains last, then alphabetically
    return result.toSorted((a, b) => {
      // Initia first
      if (a.isInitia) return -1
      if (b.isInitia) return 1

      // Excluded chains last (Civitia and Yominet)
      const aIsExcluded = excludedChains.includes(a.chainName.toLowerCase())
      const bIsExcluded = excludedChains.includes(b.chainName.toLowerCase())
      if (aIsExcluded && !bIsExcluded) return 1
      if (!aIsExcluded && bIsExcluded) return -1

      // Then by value descending
      if (b.totalValue !== a.totalValue) return b.totalValue - a.totalValue

      // Then alphabetically
      return a.chainName.localeCompare(b.chainName, undefined, { sensitivity: "base" })
    })
  }, [
    positions,
    chainInfoMap,
    searchQuery,
    selectedChain,
    layer1.chainId,
    civitiaPlayer,
    isCivitiaPlayerLoading,
  ])

  const hasPositions = filteredChainGroups.length > 0

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>Positions</span>
        {hasPositions && (
          <AsyncBoundary suspenseFallback={<FallBack height={16} width={60} length={1} />}>
            <PositionsTotalValue filteredChainGroups={filteredChainGroups} />
          </AsyncBoundary>
        )}
      </div>
      {hasPositions ? (
        <div className={styles.list}>
          {filteredChainGroups.map((chainGroup) => {
            if (chainGroup.isInitia) {
              // For L1, render InitiaPositionGroup with on-chain staking data
              // Wrap in AsyncBoundary for suspense queries (rewards)
              return (
                <AsyncBoundary
                  key={chainGroup.chainName}
                  suspenseFallback={
                    <div className={styles.skeletonWrapper}>
                      <FallBack height={56} length={1} />
                    </div>
                  }
                >
                  <InitiaPositionGroup chainGroup={chainGroup} />
                </AsyncBoundary>
              )
            }
            return <AppchainPositionGroup key={chainGroup.chainName} chainGroup={chainGroup} />
          })}
        </div>
      ) : positions.length === 0 && isLoading ? (
        <FallBack height={56} length={3} />
      ) : (
        <Status>No positions</Status>
      )}
    </div>
  )
})

Positions.displayName = "Positions"

export default Positions
