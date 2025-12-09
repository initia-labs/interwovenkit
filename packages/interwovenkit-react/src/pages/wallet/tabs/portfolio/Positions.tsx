import { useMemo } from "react"
import AsyncBoundary from "@/components/AsyncBoundary"
import FallBack from "@/components/FallBack"
import Status from "@/components/Status"
import {
  buildChainInfoMap,
  getPositionValue,
  type PortfolioChainPositionGroup,
  useMinityChainBreakdown,
  useMinityPositions,
} from "@/data/minity"
import { formatValue } from "@/lib/format"
import AppchainPositionGroup from "./AppchainPositionGroup"
import InitiaPositionGroup from "./InitiaPositionGroup"
import styles from "./Positions.module.css"

const INITIA_CHAIN_NAME = "initia"

export interface PositionsProps {
  searchQuery: string
  selectedChain: string
}

const Positions = ({ searchQuery, selectedChain }: PositionsProps) => {
  const { data: positions, isLoading } = useMinityPositions()
  const { data: chainBreakdown } = useMinityChainBreakdown()

  // Build chain info map for O(1) lookups
  const chainInfoMap = useMemo(() => buildChainInfoMap(chainBreakdown), [chainBreakdown])

  // Filter and transform positions into chain groups
  const filteredChainGroups = useMemo(() => {
    const result: PortfolioChainPositionGroup[] = []

    for (const chainData of positions) {
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
        return protocol.positions.length > 0
      })

      if (filteredProtocols.length > 0) {
        const isInitia = chainData.chainName.toLowerCase() === INITIA_CHAIN_NAME
        result.push({
          chainName: chainInfo?.chainName ?? chainData.chainName,
          chainLogo: chainInfo?.logoUrl ?? "",
          protocols: filteredProtocols,
          isInitia,
        })
      }
    }

    return result
  }, [positions, chainInfoMap, searchQuery, selectedChain])

  // Calculate total positions value
  const totalPositionsValue = useMemo(() => {
    return filteredChainGroups.reduce((sum, group) => {
      return (
        sum +
        group.protocols.reduce((pSum, protocol) => {
          return (
            pSum + protocol.positions.reduce((posSum, pos) => posSum + getPositionValue(pos), 0)
          )
        }, 0)
      )
    }, 0)
  }, [filteredChainGroups])

  // Show skeleton loading on initial load when no data exists yet
  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <span className={styles.title}>Positions</span>
        </div>
        <div className={styles.list}>
          <FallBack height={56} length={3} />
        </div>
      </div>
    )
  }

  const hasPositions = filteredChainGroups.length > 0

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>Positions</span>
        {hasPositions && (
          <span className={styles.totalValue}>{formatValue(totalPositionsValue)}</span>
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
      ) : (
        <Status>No positions</Status>
      )}
    </div>
  )
}

export default Positions
