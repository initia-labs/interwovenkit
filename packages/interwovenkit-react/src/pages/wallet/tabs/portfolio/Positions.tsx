import { useMemo } from "react"
import AsyncBoundary from "@/components/AsyncBoundary"
import FallBack from "@/components/FallBack"
import Status from "@/components/Status"
import { useLayer1 } from "@/data/chains"
import {
  getPositionValue,
  type PortfolioChainPositionGroup,
  useChainInfoMap,
  useMinityPortfolio,
} from "@/data/minity"
import AppchainPositionGroup from "./AppchainPositionGroup"
import InitiaPositionGroup from "./InitiaPositionGroup"
import PositionsTotalValue from "./PositionsTotalValue"
import styles from "./Positions.module.css"

export interface PositionsProps {
  searchQuery: string
  selectedChain: string
}

const Positions = ({ searchQuery, selectedChain }: PositionsProps) => {
  // Position data (SSE - streams progressively)
  const { positions, isLoading } = useMinityPortfolio()

  // Chain info map for chain names/logos (registry - fast, blocking)
  const chainInfoMap = useChainInfoMap()

  // Layer 1 chain info
  const layer1 = useLayer1()

  // Filter and transform positions into chain groups
  const filteredChainGroups = useMemo(() => {
    const result: PortfolioChainPositionGroup[] = []

    for (const chainData of positions) {
      // Skip if positions is not an array
      if (!Array.isArray(chainData.positions)) continue

      // Get chain info from breakdown
      const chainInfo = chainInfoMap.get(chainData.chainName.toLowerCase())

      // Filter by selected chain (using chainId)
      if (selectedChain && chainInfo?.chainId !== selectedChain) {
        continue
      }

      // Filter protocols by search query (match protocol name)
      const filteredProtocols = chainData.positions.filter((protocol) => {
        if (searchQuery && !protocol.protocol.toLowerCase().includes(searchQuery.toLowerCase())) {
          return false
        }
        return Array.isArray(protocol.positions) && protocol.positions.length > 0
      })

      if (filteredProtocols.length > 0) {
        const isInitia = layer1.chainId === chainInfo?.chainId
        const isCivitia = chainData.chainName.toLowerCase() === "civitia"

        // Calculate total value for this chain (excluding Civitia which has no USD values)
        const totalValue = isCivitia
          ? 0
          : filteredProtocols.reduce((sum, protocol) => {
              return (
                sum + protocol.positions.reduce((posSum, pos) => posSum + getPositionValue(pos), 0)
              )
            }, 0)

        result.push({
          chainName: chainInfo?.prettyName ?? chainData.chainName,
          chainLogo: chainInfo?.logoUrl ?? "",
          protocols: filteredProtocols,
          isInitia,
          totalValue,
        })
      }
    }

    // Sort: Initia first, then by value descending, then Civitia last, then alphabetically
    return result.toSorted((a, b) => {
      // Initia first
      if (a.isInitia) return -1
      if (b.isInitia) return 1

      // Civitia last (both have 0 value, but we want Civitia at the end)
      const aIsCivitia = a.chainName.toLowerCase() === "civitia"
      const bIsCivitia = b.chainName.toLowerCase() === "civitia"
      if (aIsCivitia && !bIsCivitia) return 1
      if (!aIsCivitia && bIsCivitia) return -1

      // Then by value descending
      if (b.totalValue !== a.totalValue) return b.totalValue - a.totalValue

      // Then alphabetically
      return a.chainName.localeCompare(b.chainName, undefined, { sensitivity: "base" })
    })
  }, [positions, chainInfoMap, searchQuery, selectedChain, layer1.chainId])

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
      ) : isLoading ? (
        <FallBack height={56} length={3} />
      ) : (
        <Status>No positions</Status>
      )}
    </div>
  )
}

export default Positions
