import { useMemo } from "react"
import { useInitiaLiquidityPositions } from "@/data/initia-liquidity"
import { useInitiaStakingPositions } from "@/data/initia-staking"
import { useInitiaVipPositions } from "@/data/initia-vip"
import type { PortfolioChainPositionGroup } from "@/data/minity"
import { formatValue } from "@/lib/format"
import styles from "./PositionsTotalValue.module.css"

interface PositionsTotalValueProps {
  filteredChainGroups: PortfolioChainPositionGroup[]
}

const PositionsTotalValue = ({ filteredChainGroups }: PositionsTotalValueProps) => {
  // Get L1 position totals from on-chain data
  const { totalValue: stakingValue } = useInitiaStakingPositions()
  const { totalValue: liquidityValue } = useInitiaLiquidityPositions()
  const { totalValue: vipValue } = useInitiaVipPositions()
  const l1PositionsTotal = stakingValue + liquidityValue + vipValue

  // Calculate total positions value:
  // - L1 (Initia): use on-chain data totals
  // - Appchains: use totalValue from group (already calculated, excluding Civitia)
  const totalPositionsValue = useMemo(() => {
    const hasL1 = filteredChainGroups.some((g) => g.isInitia)

    // Sum appchain totals (excluding L1)
    const appchainTotal = filteredChainGroups.reduce((sum, group) => {
      if (group.isInitia) return sum // Skip L1, use on-chain data instead
      return sum + group.totalValue
    }, 0)

    // Add L1 on-chain total if L1 is in filtered groups
    return appchainTotal + (hasL1 ? l1PositionsTotal : 0)
  }, [filteredChainGroups, l1PositionsTotal])

  return <span className={styles.totalValue}>{formatValue(totalPositionsValue)}</span>
}

export default PositionsTotalValue
