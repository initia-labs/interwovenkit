import clsx from "clsx"
import { Collapsible } from "radix-ui"
import { useMemo } from "react"
import { atom, useAtom } from "jotai"
import { IconChevronDown, IconExternalLink } from "@initia/icons-react"
import Image from "@/components/Image"
import { INITIA_LIQUIDITY_URL } from "@/data/constants"
import { useInitiaLiquidityPositions } from "@/data/initia-liquidity"
import { useInitiaStakingPositions } from "@/data/initia-staking"
import { useInitiaVipPositions } from "@/data/initia-vip"
import {
  buildDenomLogoMap,
  getPositionValue,
  type PortfolioChainPositionGroup,
} from "@/data/minity"
import { usePortfolio } from "@/data/portfolio"
import { formatValue } from "@/lib/format"
import LiquiditySection from "./LiquiditySection"
import PositionSectionList from "./PositionSection"
import VipSection from "./VipSection"
import styles from "./InitiaPositionGroup.module.css"

const openInitiaGroupAtom = atom<boolean>(false)

interface Props {
  chainGroup: PortfolioChainPositionGroup
}

const InitiaPositionGroup = ({ chainGroup }: Props) => {
  const { chainName, chainLogo } = chainGroup
  const { assetGroups } = usePortfolio()

  // Fetch on-chain staking positions
  const { positions: stakingPositions } = useInitiaStakingPositions()

  // Fetch on-chain liquidity positions
  const liquidityData = useInitiaLiquidityPositions()

  // Fetch VIP vesting positions
  const vipData = useInitiaVipPositions()

  // Build denom -> logo map from portfolio asset groups
  const denomLogoMap = useMemo(() => buildDenomLogoMap(assetGroups), [assetGroups])

  const [isOpen, setIsOpen] = useAtom(openInitiaGroupAtom)

  // Calculate total value from on-chain staking + liquidity + VIP positions
  const totalValue = useMemo(() => {
    const stakingValue = stakingPositions.reduce((sum, pos) => sum + getPositionValue(pos), 0)
    return stakingValue + liquidityData.totalValue + vipData.totalValue
  }, [stakingPositions, liquidityData.totalValue, vipData.totalValue])

  // Create a protocol object for PositionSectionList
  const protocols = useMemo(() => {
    if (stakingPositions.length === 0) return []
    return [
      {
        protocol: "Initia",
        manageUrl: INITIA_LIQUIDITY_URL,
        positions: stakingPositions,
      },
    ]
  }, [stakingPositions])

  // Don't render if no positions
  const hasPositions =
    stakingPositions.length > 0 || liquidityData.rows.length > 0 || vipData.rows.length > 0
  if (!hasPositions) {
    return null
  }

  return (
    <div className={styles.container}>
      <Collapsible.Root open={isOpen} onOpenChange={setIsOpen}>
        <Collapsible.Trigger asChild>
          <button className={styles.trigger}>
            <div className={styles.chainInfo}>
              {chainLogo && (
                <Image src={chainLogo} width={32} height={32} className={styles.logo} logo />
              )}
              <div className={styles.chainNameContainer}>
                <span className={styles.chainName}>{chainName}</span>
                <a
                  href={INITIA_LIQUIDITY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.externalLink}
                  onClick={(e) => e.stopPropagation()}
                >
                  <IconExternalLink size={12} className={styles.externalIcon} />
                </a>
              </div>
            </div>
            <div className={styles.valueColumn}>
              <span className={styles.value}>{formatValue(totalValue)}</span>
              <IconChevronDown
                size={16}
                className={clsx(styles.expandIcon, { [styles.expanded]: isOpen })}
              />
            </div>
          </button>
        </Collapsible.Trigger>

        <Collapsible.Content className={styles.collapsibleContent}>
          <div className={styles.content}>
            {/* Staking section */}
            {protocols.length > 0 && (
              <PositionSectionList protocols={protocols} denomLogoMap={denomLogoMap} />
            )}
            {/* Liquidity section */}
            {liquidityData.rows.length > 0 && (
              <LiquiditySection data={liquidityData} denomLogoMap={denomLogoMap} />
            )}
            {/* VIP section */}
            {vipData.rows.length > 0 && <VipSection data={vipData} />}
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  )
}

export default InitiaPositionGroup
