import clsx from "clsx"
import { Collapsible } from "radix-ui"
import { useMemo, useState } from "react"
import { IconChevronDown, IconExternalLink } from "@initia/icons-react"
import { formatNumber } from "@initia/utils"
import Image from "@/components/Image"
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
} from "@/data/minity"
import { formatValue } from "@/lib/format"
import styles from "./PositionSection.module.css"

export type DenomLogoMap = Map<string, { assetLogo: string; chainLogo: string }>

interface PositionSectionListProps {
  protocols: ProtocolPosition[]
  denomLogoMap: DenomLogoMap
}

const PositionSectionList = ({ protocols, denomLogoMap }: PositionSectionListProps) => {
  const sectionGroups = useMemo(() => {
    const allPositions = protocols.flatMap((p) => p.positions)
    return groupPositionsBySection(allPositions)
  }, [protocols])

  if (sectionGroups.size === 0) return null

  return (
    <div className={styles.container}>
      {Array.from(sectionGroups.entries()).map(([sectionKey, positions]) => (
        <PositionSection
          key={sectionKey}
          sectionKey={sectionKey}
          positions={positions}
          denomLogoMap={denomLogoMap}
        />
      ))}
    </div>
  )
}

interface PositionSectionProps {
  sectionKey: string
  positions: Position[]
  denomLogoMap: DenomLogoMap
}

const PositionSection = ({ sectionKey, positions, denomLogoMap }: PositionSectionProps) => {
  const label = getSectionLabel(sectionKey)
  const denomGroups = useMemo(() => groupPositionsByDenom(positions), [positions])
  const isStakingSection = sectionKey === "staking"

  const totalValue = useMemo(() => {
    return positions.reduce((sum, pos) => sum + getPositionValue(pos), 0)
  }, [positions])

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>
          <span className={styles.sectionLabel}>{label}</span>
          {isStakingSection && (
            <a
              href="https://app.initia.xyz/liquidity/my"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.externalLink}
              onClick={(e) => e.stopPropagation()}
            >
              <IconExternalLink size={12} />
            </a>
          )}
        </div>
        <span className={styles.sectionValue}>{formatValue(totalValue)}</span>
      </div>
      <div className={clsx(styles.tokenList, { [styles.stakingTokenList]: isStakingSection })}>
        {denomGroups.map((group) => (
          <TokenRow
            key={group.denom}
            group={group}
            showTypeBreakdown={isStakingSection}
            denomLogoMap={denomLogoMap}
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
}

const TokenRow = ({ group, showTypeBreakdown, denomLogoMap }: TokenRowProps) => {
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
        <div className={styles.typeBreakdown}>
          {Array.from(typeGroups.entries()).map(([type, typePositions]) => {
            const typeAmount = typePositions.reduce((sum, pos) => {
              if (pos.type === "fungible-position") return sum
              if (pos.balance.type === "unknown") return sum
              return sum + pos.balance.formattedAmount
            }, 0)
            const typeValue = typePositions.reduce((sum, pos) => sum + getPositionValue(pos), 0)
            return (
              <div key={type} className={styles.typeRow}>
                <span className={styles.typeLabel}>{getPositionTypeLabel(type)}</span>
                <div className={styles.typeValues}>
                  <span className={styles.typeAmount}>
                    {formatNumber(typeAmount, { dp: 6 })} {symbol}
                  </span>
                  <span className={styles.typeValue}>{formatValue(typeValue)}</span>
                </div>
              </div>
            )
          })}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

export default PositionSectionList
