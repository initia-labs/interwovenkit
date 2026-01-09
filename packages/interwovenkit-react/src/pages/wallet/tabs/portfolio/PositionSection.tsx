import clsx from "clsx"
import { Collapsible } from "radix-ui"
import { useMemo, useState } from "react"
import { IconChevronDown, IconExternalLink } from "@initia/icons-react"
import { formatNumber } from "@initia/utils"
import Image from "@/components/Image"
import { INIT_SYMBOL } from "@/data/constants"
import {
  type DenomGroup,
  getPositionTypeLabel,
  getPositionValue,
  getSectionLabel,
  groupPositionsByDenom,
  groupPositionsBySection,
  groupPositionsByType,
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
  isInitia?: boolean
  getClaimableInitByType?: (denom: string, type: Position["type"]) => string
  initPrice?: number
}

const PositionSectionList = ({
  protocols,
  denomLogoMap,
  isInitia,
  getClaimableInitByType,
  initPrice,
}: PositionSectionListProps) => {
  // Get manageUrl from first protocol (they typically share the same URL)
  const manageUrl = protocols[0]?.manageUrl

  const sectionGroups = useMemo(() => {
    const allPositions = protocols.flatMap((p) => p.positions)
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
  isInitia?: boolean
  manageUrl?: string
  getClaimableInitByType?: (denom: string, type: Position["type"]) => string
  initPrice?: number
}

const PositionSection = ({
  sectionKey,
  sectionGroup,
  denomLogoMap,
  isInitia,
  manageUrl,
  getClaimableInitByType,
  initPrice,
}: PositionSectionProps) => {
  const { positions, totalValue } = sectionGroup
  const label = getSectionLabel(sectionKey, isInitia)
  const denomGroups = useMemo(() => groupPositionsByDenom(positions), [positions])
  const isStakingSection = sectionKey === "staking"
  const isBorrowingSection = sectionKey === "borrowing"

  // Display absolute value for borrowing (but keep calculation as negative)
  const displayValue = isBorrowingSection ? Math.abs(totalValue) : totalValue

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>
          <span className={styles.sectionLabel}>{label}</span>
          {isStakingSection && manageUrl && (
            <a
              href={manageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.externalLink}
              onClick={(e) => e.stopPropagation()}
            >
              <IconExternalLink size={12} />
            </a>
          )}
        </div>
        <span className={styles.sectionValue}>{formatValue(displayValue)}</span>
      </div>
      <div className={clsx(styles.tokenList, { [styles.stakingTokenList]: isStakingSection })}>
        {denomGroups.map((group) => (
          <TokenRow
            key={group.denom}
            group={group}
            showTypeBreakdown={isStakingSection}
            denomLogoMap={denomLogoMap}
            getClaimableInitByType={getClaimableInitByType}
            initPrice={initPrice}
          />
        ))}
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

  // Check if this is a borrowing position (has negative value)
  const isBorrowing = positions.some((pos) => pos.type === "lending" && pos.direction === "borrow")
  const displayValue = isBorrowing ? Math.abs(totalValue) : totalValue

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
            <span className={styles.tokenValue}>{formatValue(displayValue)}</span>
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
            />
            <div className={styles.tokenInfoLabel}>
              {logos?.assetLogo && (
                <Image src={logos.assetLogo} width={20} height={20} className={styles.tokenLogo} />
              )}
              <span className={styles.tokenSymbol}>{symbol}</span>
            </div>
          </div>
          <span className={styles.triggerValue}>{formatValue(displayValue)}</span>
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
      const typeAmount = typePositions.reduce((sum, pos) => {
        if (pos.type === "fungible-position") return sum
        if (pos.balance.type === "unknown") return sum
        return sum + pos.balance.formattedAmount
      }, 0)
      const typeValue = typePositions.reduce((sum, pos) => sum + getPositionValue(pos), 0)
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
          <span className={styles.typeLabel}>Claimable</span>
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
