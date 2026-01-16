import clsx from "clsx"
import { Collapsible } from "radix-ui"
import { useMemo } from "react"
import { atom, useAtom } from "jotai"
import { IconChevronDown, IconExternalLink } from "@initia/icons-react"
import { denomToMetadata, fromBaseUnit } from "@initia/utils"
import AsyncBoundary from "@/components/AsyncBoundary"
import Image from "@/components/Image"
import Skeletons from "@/components/Skeletons"
import { useAllChainsAssetsQueries } from "@/data/assets"
import { useLayer1, usePricesQuery } from "@/data/chains"
import { INIT_DECIMALS, INIT_DENOM, INITIA_LIQUIDITY_URL } from "@/data/constants"
import { useInitiaLiquidityPositions } from "@/data/initia-liquidity"
import {
  useInitiaLockStakingRewards,
  useInitiaStakingPositions,
  useInitiaStakingRewards,
} from "@/data/initia-staking"
import { useInitiaVipPositions } from "@/data/initia-vip"
import { buildAssetLogoMaps, type PortfolioChainPositionGroup, type Position } from "@/data/minity"
import { formatValue } from "@/lib/format"
import LiquiditySection from "./LiquiditySection"
import PositionSectionList, { type DenomLogoMap } from "./PositionSection"
import VipSection from "./VipSection"
import styles from "./InitiaPositionGroup.module.css"

const openInitiaGroupAtom = atom<boolean>(false)

interface Props {
  chainGroup: PortfolioChainPositionGroup
}

/* -------------------------------------------------------------------------- */
/*                              Total Value                                   */
/* -------------------------------------------------------------------------- */

const InitiaTotalValue = () => {
  const { totalValue: stakingValue } = useInitiaStakingPositions()
  const { totalValue: liquidityValue } = useInitiaLiquidityPositions()
  const { totalValue: vipValue } = useInitiaVipPositions()

  const totalValue = stakingValue + liquidityValue + vipValue

  return <span className={styles.value}>{formatValue(totalValue)}</span>
}

/* -------------------------------------------------------------------------- */
/*                              Staking Section                               */
/* -------------------------------------------------------------------------- */

interface StakingSectionProps {
  chainLogo: string
  denomLogos: Map<string, string>
  symbolLogos: Map<string, string>
  initPrice: number
}

const InitiaStakingSection = ({
  chainLogo,
  denomLogos,
  symbolLogos,
  initPrice,
}: StakingSectionProps) => {
  const { positions: stakingPositions } = useInitiaStakingPositions()
  const { data: stakingRewards } = useInitiaStakingRewards()
  const { data: lockStakingRewards } = useInitiaLockStakingRewards()

  // Build combined denom -> logo map with fallback logic
  const denomLogoMap: DenomLogoMap = useMemo(() => {
    const map = new Map<string, { assetLogo: string; chainLogo: string }>()

    for (const pos of stakingPositions) {
      if (pos.type === "fungible-position") continue
      if (pos.balance.type === "unknown") continue

      const { denom, symbol } = pos.balance
      const upperSymbol = symbol.toUpperCase()
      const assetLogo = denomLogos.get(denom) ?? symbolLogos.get(upperSymbol)

      if (assetLogo) {
        map.set(denom, { assetLogo, chainLogo })
      }
    }

    return map
  }, [stakingPositions, denomLogos, symbolLogos, chainLogo])

  // Get claimable INIT for a specific position type
  const getClaimableInitByType = useMemo(
    () =>
      (denom: string, type: Position["type"]): string => {
        const metadata = denomToMetadata(denom)

        if (type === "staking") {
          const stakingReward = stakingRewards?.get(metadata)
          return stakingReward
            ? fromBaseUnit(stakingReward.amount, { decimals: INIT_DECIMALS })
            : "0"
        }

        if (type === "lockstaking") {
          const lockReward = lockStakingRewards?.get(metadata)
          return lockReward ? fromBaseUnit(lockReward.amount, { decimals: INIT_DECIMALS }) : "0"
        }

        // Unstaking doesn't earn rewards
        return "0"
      },
    [stakingRewards, lockStakingRewards],
  )

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

  if (protocols.length === 0) {
    return null
  }

  return (
    <PositionSectionList
      protocols={protocols}
      denomLogoMap={denomLogoMap}
      isInitia
      getClaimableInitByType={getClaimableInitByType}
      initPrice={initPrice}
    />
  )
}

/* -------------------------------------------------------------------------- */
/*                             Liquidity Section                              */
/* -------------------------------------------------------------------------- */

interface LiquiditySectionWrapperProps {
  chainLogo: string
  denomLogos: Map<string, string>
  symbolLogos: Map<string, string>
}

const InitiaLiquiditySectionWrapper = ({
  chainLogo,
  denomLogos,
  symbolLogos,
}: LiquiditySectionWrapperProps) => {
  const liquidityData = useInitiaLiquidityPositions()

  // Build denom -> logo map for liquidity positions
  // Note: LiquidityTableRow already has coinLogos/logoUrl from the hook,
  // this map provides fallback for any missing logos
  const denomLogoMap: DenomLogoMap = useMemo(() => {
    const map = new Map<string, { assetLogo: string; chainLogo: string }>()

    for (const row of liquidityData.rows) {
      const { denom, symbol } = row
      const upperSymbol = symbol.toUpperCase()
      const assetLogo = denomLogos.get(denom) ?? symbolLogos.get(upperSymbol)

      if (assetLogo) {
        map.set(denom, { assetLogo, chainLogo })
      }
    }

    return map
  }, [liquidityData.rows, denomLogos, symbolLogos, chainLogo])

  if (liquidityData.rows.length === 0) {
    return null
  }

  return <LiquiditySection data={liquidityData} denomLogoMap={denomLogoMap} />
}

/* -------------------------------------------------------------------------- */
/*                                VIP Section                                 */
/* -------------------------------------------------------------------------- */

const InitiaVipSectionWrapper = () => {
  const vipData = useInitiaVipPositions()

  if (vipData.rows.length === 0) {
    return null
  }

  return <VipSection data={vipData} />
}

/* -------------------------------------------------------------------------- */
/*                           Main Component                                   */
/* -------------------------------------------------------------------------- */

const InitiaPositionGroup = ({ chainGroup }: Props) => {
  const { chainName, chainLogo } = chainGroup
  const [isOpen, setIsOpen] = useAtom(openInitiaGroupAtom)

  // Shared asset logos - fetch once and pass to child components
  const assetsQueries = useAllChainsAssetsQueries()
  const { denomLogos, symbolLogos } = useMemo(
    () => buildAssetLogoMaps(assetsQueries),
    [assetsQueries],
  )

  // Shared INIT price - fetch once and pass to staking section
  const layer1 = useLayer1()
  const { data: prices } = usePricesQuery(layer1)
  const initPrice = useMemo(() => {
    const initPriceItem = prices?.find((p) => p.id === INIT_DENOM)
    return initPriceItem?.price ?? 0
  }, [prices])

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
              <AsyncBoundary suspenseFallback={<Skeletons height={16} width={60} length={1} />}>
                <InitiaTotalValue />
              </AsyncBoundary>
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
            <AsyncBoundary suspenseFallback={<Skeletons height={36} length={2} />}>
              <InitiaStakingSection
                chainLogo={chainLogo}
                denomLogos={denomLogos}
                symbolLogos={symbolLogos}
                initPrice={initPrice}
              />
            </AsyncBoundary>

            {/* Liquidity section */}
            <AsyncBoundary suspenseFallback={<Skeletons height={36} length={2} />}>
              <InitiaLiquiditySectionWrapper
                chainLogo={chainLogo}
                denomLogos={denomLogos}
                symbolLogos={symbolLogos}
              />
            </AsyncBoundary>

            {/* VIP section */}
            <AsyncBoundary suspenseFallback={<Skeletons height={36} length={1} />}>
              <InitiaVipSectionWrapper />
            </AsyncBoundary>
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  )
}

export default InitiaPositionGroup
