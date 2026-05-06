import clsx from "clsx"
import { Collapsible } from "radix-ui"
import { useMemo, useState } from "react"
import { IconChevronDown, IconExternalLink } from "@initia/icons-react"
import { formatNumber } from "@initia/utils"
import Image from "@/components/Image"
import { INIT_SYMBOL, STRAT_CHAIN_NAME } from "@/data/constants"
import {
  type DenomGroup,
  formatPerpLeverage,
  formatPerpPnl,
  formatPerpPnlPercent,
  getPerpCollateralValue,
  getPerpPnl,
  getPositionTypeLabel,
  getPositionValue,
  getSectionLabel,
  groupPositionsByDenom,
  groupPositionsBySection,
  groupPositionsByType,
  isPerpUnpriced,
  type PerpPosition,
  type Position,
  type ProtocolPosition,
  type SectionGroup,
} from "@/data/minity"
import { formatValue } from "@/lib/format"
import styles from "./PositionSection.module.css"

export type DenomLogoMap = Map<string, { assetLogo: string; chainLogo: string }>

interface PositionSectionListProps {
  protocols: ProtocolPosition[]
  denomLogoMap: DenomLogoMap
  chainName?: string
  isInitia?: boolean
  getClaimableInitByType?: (denom: string, type: Position["type"]) => string
  initPrice?: number
}

const PositionSectionList = ({
  protocols,
  denomLogoMap,
  chainName,
  isInitia,
  getClaimableInitByType,
  initPrice,
}: PositionSectionListProps) => {
  // Get manageUrl from first protocol (they typically share the same URL)
  const manageUrl = protocols[0]?.manageUrl

  const sectionGroups = useMemo(() => {
    const allPositions = protocols.flatMap((protocol) => protocol.positions)
    return groupPositionsBySection(allPositions)
  }, [protocols])

  if (sectionGroups.size === 0) return null

  return (
    <div className={styles.container}>
      {Array.from(sectionGroups.entries()).map(([sectionKey, sectionGroup]) => (
        <PositionSection
          key={sectionKey}
          sectionKey={sectionKey}
          sectionGroup={sectionGroup}
          denomLogoMap={denomLogoMap}
          chainName={chainName}
          isInitia={isInitia}
          manageUrl={manageUrl}
          getClaimableInitByType={getClaimableInitByType}
          initPrice={initPrice}
        />
      ))}
    </div>
  )
}

interface PositionSectionProps {
  sectionKey: string
  sectionGroup: SectionGroup
  denomLogoMap: DenomLogoMap
  chainName?: string
  isInitia?: boolean
  manageUrl?: string
  getClaimableInitByType?: (denom: string, type: Position["type"]) => string
  initPrice?: number
}

const PositionSection = ({
  sectionKey,
  sectionGroup,
  denomLogoMap,
  chainName,
  isInitia,
  manageUrl,
  getClaimableInitByType,
  initPrice,
}: PositionSectionProps) => {
  const { positions, totalValue } = sectionGroup
  const label = getSectionLabel(sectionKey, { isInitia, chainName })
  const isStakingSection = sectionKey === "staking"
  const isStratChain = chainName?.toLowerCase() === STRAT_CHAIN_NAME
  // Strat reuses `staking` for vault deposits with no claimable rewards or breakdown — render flat, no accordion.
  const showStakingBreakdown = isStakingSection && !isStratChain
  const isPerpSection = sectionKey === "perp"
  const denomGroups = useMemo(
    () => (isPerpSection ? [] : groupPositionsByDenom(positions)),
    [positions, isPerpSection],
  )

  return (
    <section className={styles.section} aria-label={label}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>
          <span className={styles.sectionLabel}>{label}</span>
          {showStakingBreakdown && manageUrl && (
            <a
              href={manageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.externalLink}
              onClick={(e) => e.stopPropagation()}
            >
              <IconExternalLink size={12} aria-hidden="true" />
            </a>
          )}
        </div>
        <span className={styles.sectionValue}>{formatValue(totalValue)}</span>
      </div>
      {isPerpSection ? (
        <div className={styles.tokenList}>
          {positions
            .filter((position): position is PerpPosition => position.type === "perp-position")
            .map((position, idx) => (
              // API doesn't guarantee pair+direction uniqueness (user can hold multiple concurrent BTC/USDT longs) — index avoids key collisions.
              <PerpRow key={`${position.pair}-${position.direction}-${idx}`} position={position} />
            ))}
        </div>
      ) : (
        <div
          className={clsx(styles.tokenList, { [styles.stakingTokenList]: showStakingBreakdown })}
        >
          {denomGroups.map((group) => (
            <TokenRow
              key={group.denom}
              group={group}
              showTypeBreakdown={showStakingBreakdown}
              denomLogoMap={denomLogoMap}
              getClaimableInitByType={getClaimableInitByType}
              initPrice={initPrice}
            />
          ))}
        </div>
      )}
    </section>
  )
}

interface PerpRowProps {
  position: PerpPosition
}

function getPerpPnlClass(pnl: number | null): string {
  if (pnl == null || !Number.isFinite(pnl) || pnl === 0) return styles.perpPnlNeutral
  return pnl > 0 ? styles.perpPnlPositive : styles.perpPnlNegative
}

const PerpRow = ({ position }: PerpRowProps) => {
  const isLong = position.direction === "long"
  const pnl = getPerpPnl(position)
  const collateralValue = getPerpCollateralValue(position)
  const value = getPositionValue(position)
  const unpriced = isPerpUnpriced(position)
  const percent = formatPerpPnlPercent(pnl, collateralValue)
  const pnlDisplay = percent ? `${formatPerpPnl(pnl)} ${percent}` : formatPerpPnl(pnl)
  const directionLabel = isLong ? "Long" : "Short"
  const leverage = formatPerpLeverage(position.leverage)
  const positionLabel = leverage ? `${leverage}X ${directionLabel}` : directionLabel
  const valueDisplay = unpriced ? "—" : formatValue(value)

  return (
    <div className={styles.perpRow}>
      <div className={styles.perpToken}>
        {position.imageUrl && (
          <Image src={position.imageUrl} width={20} height={20} className={styles.tokenLogo} />
        )}
        <span className={styles.tokenSymbol}>{position.pair}</span>
        <span className={isLong ? styles.perpDirectionLong : styles.perpDirectionShort}>
          {positionLabel}
        </span>
      </div>
      <div className={styles.perpValues}>
        <span className={clsx(styles.perpPnl, getPerpPnlClass(pnl))}>{pnlDisplay}</span>
        <span className={styles.tokenValue}>{valueDisplay}</span>
      </div>
    </div>
  )
}

interface TokenRowProps {
  group: DenomGroup
  showTypeBreakdown: boolean
  denomLogoMap: DenomLogoMap
  getClaimableInitByType?: (denom: string, type: Position["type"]) => string
  initPrice?: number
}

const TokenRow = ({
  group,
  showTypeBreakdown,
  denomLogoMap,
  getClaimableInitByType,
  initPrice,
}: TokenRowProps) => {
  const { denom, symbol, totalAmount, totalValue, positions } = group
  const logos = denomLogoMap.get(denom)
  const [isOpen, setIsOpen] = useState(false)

  const typeGroups = useMemo(() => {
    if (!showTypeBreakdown) return null
    const groups = groupPositionsByType(positions)
    return groups.size > 0 ? groups : null
  }, [positions, showTypeBreakdown])

  // If no type breakdown, render simple row
  if (!typeGroups) {
    return (
      <div className={styles.tokenRow}>
        <div className={styles.tokenMain}>
          <div className={styles.tokenInfo}>
            {logos?.assetLogo && (
              <Image src={logos.assetLogo} width={20} height={20} className={styles.tokenLogo} />
            )}
            <span className={styles.tokenSymbol}>{symbol}</span>
          </div>
          <div className={styles.tokenValues}>
            <span className={styles.tokenAmount}>{formatNumber(totalAmount, { dp: 6 })}</span>
            <span className={styles.tokenValue}>{formatValue(totalValue)}</span>
          </div>
        </div>
      </div>
    )
  }

  // Render collapsible row with type breakdown
  return (
    <Collapsible.Root open={isOpen} onOpenChange={setIsOpen}>
      <Collapsible.Trigger asChild>
        <button className={styles.tokenTrigger}>
          <div className={styles.tokenInfo}>
            <IconChevronDown
              size={14}
              className={clsx(styles.tokenChevron, { [styles.expanded]: isOpen })}
              aria-hidden="true"
            />
            <div className={styles.tokenInfoLabel}>
              {logos?.assetLogo && (
                <Image src={logos.assetLogo} width={20} height={20} className={styles.tokenLogo} />
              )}
              <span className={styles.tokenSymbol}>{symbol}</span>
            </div>
          </div>
          <span className={styles.triggerValue}>{formatValue(totalValue)}</span>
        </button>
      </Collapsible.Trigger>

      <Collapsible.Content className={styles.collapsibleContent}>
        <TypeBreakdown
          typeGroups={typeGroups}
          symbol={symbol}
          denom={denom}
          getClaimableInitByType={getClaimableInitByType}
          initPrice={initPrice}
        />
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

interface TypeBreakdownProps {
  typeGroups: Map<Position["type"], Position[]>
  symbol: string
  denom: string
  getClaimableInitByType?: (denom: string, type: Position["type"]) => string
  initPrice?: number
}

const TypeBreakdown = ({
  typeGroups,
  symbol,
  denom,
  getClaimableInitByType,
  initPrice,
}: TypeBreakdownProps) => {
  // Pre-calculate all type amounts and values
  const typeData = useMemo(() => {
    return Array.from(typeGroups.entries()).map(([type, typePositions]) => {
      const typeAmount = typePositions.reduce((sum, position) => {
        if (position.type === "fungible-position" || position.type === "perp-position") return sum
        if (position.balance.type === "unknown") return sum
        return sum + position.balance.formattedAmount
      }, 0)
      const typeValue = typePositions.reduce((sum, position) => sum + getPositionValue(position), 0)
      return { type, typeAmount, typeValue }
    })
  }, [typeGroups])

  // Calculate total claimable across all types
  const totalClaimable = useMemo(() => {
    if (!getClaimableInitByType) return 0
    let total = 0
    for (const { type } of typeData) {
      const claimable = getClaimableInitByType(denom, type)
      total += Number(claimable)
    }
    return total
  }, [denom, getClaimableInitByType, typeData])

  const hasClaimable = totalClaimable > 0

  return (
    <div className={styles.typeBreakdown}>
      {typeData.map(({ type, typeAmount, typeValue }) => (
        <div key={type} className={styles.typeRow}>
          <span className={styles.typeLabel}>{getPositionTypeLabel(type)}</span>
          <div className={styles.typeValues}>
            <span className={styles.typeAmount}>
              {formatNumber(typeAmount, { dp: 6 })} {symbol}
            </span>
            <span className={styles.typeValue}>{formatValue(typeValue)}</span>
          </div>
        </div>
      ))}
      {hasClaimable && (
        <div className={styles.typeRow}>
          <span className={styles.typeLabel}>Claimable rewards</span>
          <div className={styles.typeValues}>
            <span className={styles.typeAmount}>
              {formatNumber(totalClaimable, { dp: 6 })} {INIT_SYMBOL}
            </span>
            <span className={styles.typeValue}>
              {formatValue(totalClaimable * (initPrice ?? 0))}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export default PositionSectionList
