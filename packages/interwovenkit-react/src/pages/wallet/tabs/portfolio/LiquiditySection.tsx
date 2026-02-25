import clsx from "clsx"
import { Collapsible } from "radix-ui"
import { type ReactNode, useMemo, useState } from "react"
import { IconChevronDown, IconExternalLink } from "@initia/icons-react"
import { formatNumber } from "@initia/utils"
import Image from "@/components/Image"
import { INIT_SYMBOL, INITIA_LIQUIDITY_URL } from "@/data/constants"
import type { ClammLiquidityPosition, LiquiditySectionData, LiquidityTableRow } from "@/data/minity"
import { formatValue } from "@/lib/format"
import type { DenomLogoMap } from "./PositionSection"
import styles from "./LiquiditySection.module.css"

interface LiquiditySectionProps {
  data: LiquiditySectionData
  denomLogoMap: DenomLogoMap
}

const LiquiditySection = ({ data, denomLogoMap }: LiquiditySectionProps) => {
  const { totalValue, rows } = data

  if (rows.length === 0) return null

  return (
    <div className={styles.container}>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>
            <span className={styles.sectionLabel}>Liquidity</span>
            <a
              href={INITIA_LIQUIDITY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.externalLink}
              onClick={(e) => e.stopPropagation()}
            >
              <IconExternalLink size={12} />
            </a>
          </div>
          <span className={styles.sectionValue}>{formatValue(totalValue)}</span>
        </div>
        <div className={styles.tokenList}>
          {rows.map((row) => (
            <LiquidityRow key={row.denom} row={row} denomLogoMap={denomLogoMap} />
          ))}
        </div>
      </div>
    </div>
  )
}

interface LiquidityRowProps {
  row: LiquidityTableRow
  denomLogoMap: DenomLogoMap
}

interface LiquidityRowTriggerProps {
  isOpen: boolean
  symbol: string
  coinLogos?: string[]
  singleLogoUrl?: string
  rightContent: ReactNode
}

const BREAKDOWN_LABELS: Record<keyof LiquidityTableRow["breakdown"], string> = {
  deposit: "Deposit",
  staking: "Staking",
  lockStaking: "Lock staking",
  unstaking: "Unstaking",
}

function getClammStatusClass(inRange: boolean | undefined): string {
  if (inRange === undefined) return styles.unknown
  if (inRange) return styles.inRange
  return styles.outRange
}

function getClammStatusText(inRange: boolean | undefined): string {
  if (inRange === undefined) return "Status unavailable"
  if (inRange) return "In range"
  return "Out of range"
}

function formatBoundValue(value: number | undefined, pairLabel: string): string {
  if (value === undefined) return "-"
  return `${formatNumber(value, { dp: 6 })} ${pairLabel}`
}

function renderLiquidityRowTrigger({
  isOpen,
  symbol,
  coinLogos,
  singleLogoUrl,
  rightContent,
}: LiquidityRowTriggerProps) {
  const hasCoinLogos = coinLogos && coinLogos.length > 0 && coinLogos.some((coinLogo) => coinLogo)

  return (
    <button className={styles.tokenTrigger}>
      <div className={styles.tokenInfo}>
        <IconChevronDown
          size={14}
          className={clsx(styles.tokenChevron, { [styles.expanded]: isOpen })}
        />
        <div className={styles.tokenInfoLabel}>
          {hasCoinLogos ? (
            <div className={styles.pairedLogos}>
              {coinLogos.map((coinLogo, idx) => (
                <Image
                  key={idx}
                  src={coinLogo}
                  width={20}
                  height={20}
                  className={styles.coinLogo}
                  logo
                />
              ))}
            </div>
          ) : (
            singleLogoUrl && (
              <Image src={singleLogoUrl} width={20} height={20} className={styles.tokenLogo} />
            )
          )}
          <span className={styles.tokenSymbol}>{symbol}</span>
        </div>
      </div>
      {rightContent}
    </button>
  )
}

const ClammPositionRow = ({ position }: { position: ClammLiquidityPosition }) => {
  const statusClass = getClammStatusClass(position.inRange)
  const statusText = getClammStatusText(position.inRange)

  return (
    <div className={styles.clammPositionRow}>
      <div className={styles.breakdownRow}>
        <span className={styles.breakdownLabel}>Position ID</span>
        <div className={styles.breakdownValues}>
          <span className={styles.breakdownAmount}>{position.positionId}</span>
        </div>
      </div>

      <div className={styles.breakdownRow}>
        <span className={styles.breakdownLabel}>Deposit</span>
        <div className={styles.breakdownValues}>
          <span className={styles.breakdownValue}>{formatValue(position.value)}</span>
        </div>
      </div>

      <div className={styles.breakdownRow}>
        <span className={styles.breakdownLabel}>Status</span>
        <div className={styles.clammStatusValue}>
          <span className={clsx(styles.statusDot, statusClass)} />
          <span>{statusText}</span>
        </div>
      </div>

      {position.isFullRange ? (
        <div className={styles.breakdownRow}>
          <span className={styles.breakdownLabel}>Range Bounds</span>
          <div className={styles.breakdownValues}>
            <span className={styles.breakdownAmount}>Full range</span>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.breakdownRow}>
            <span className={styles.breakdownLabel}>Min</span>
            <div className={styles.breakdownValues}>
              <span className={styles.breakdownAmount}>
                {formatBoundValue(position.minPrice, position.pricePairLabel)}
              </span>
            </div>
          </div>
          <div className={styles.breakdownRow}>
            <span className={styles.breakdownLabel}>Max</span>
            <div className={styles.breakdownValues}>
              <span className={styles.breakdownAmount}>
                {formatBoundValue(position.maxPrice, position.pricePairLabel)}
              </span>
            </div>
          </div>
        </>
      )}

      <div className={styles.breakdownRow}>
        <span className={styles.breakdownLabel}>Reward</span>
        <div className={styles.breakdownValues}>
          <span className={styles.breakdownValue}>{formatValue(position.rewardValue)}</span>
        </div>
      </div>
    </div>
  )
}

const ClammLiquidityRow = ({ row, denomLogoMap }: LiquidityRowProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const { denom, symbol, totalValue, coinLogos, logoUrl, clamm } = row
  const logos = denomLogoMap.get(denom)

  if (!clamm) return null

  const singleLogoUrl = logoUrl || logos?.assetLogo

  return (
    <Collapsible.Root open={isOpen} onOpenChange={setIsOpen}>
      <Collapsible.Trigger asChild>
        {renderLiquidityRowTrigger({
          isOpen,
          symbol,
          coinLogos,
          singleLogoUrl,
          rightContent: <span className={styles.triggerValue}>{formatValue(totalValue)}</span>,
        })}
      </Collapsible.Trigger>

      <Collapsible.Content className={styles.collapsibleContent}>
        <div className={styles.clammBreakdownContent}>
          <div className={styles.breakdownRow}>
            <span className={styles.breakdownLabel}>Reward</span>
            <div className={styles.breakdownValues}>
              <span className={styles.breakdownValue}>{formatValue(clamm.totalRewardValue)}</span>
            </div>
          </div>
          {clamm.positions.map((position) => (
            <ClammPositionRow key={position.tokenAddress} position={position} />
          ))}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

const StandardLiquidityRow = ({ row, denomLogoMap }: LiquidityRowProps) => {
  const { denom, symbol, totalValue, breakdown, logoUrl, coinLogos, claimableInit } = row
  const [isOpen, setIsOpen] = useState(false)
  const logos = denomLogoMap.get(denom)

  const singleLogoUrl = logoUrl || logos?.assetLogo
  const pricePerUnit = row.totalAmount > 0 ? row.totalValue / row.totalAmount : 0

  const breakdownEntries = useMemo(
    () =>
      (Object.entries(breakdown) as [keyof typeof breakdown, number][]).filter(
        ([, amount]) => amount > 0,
      ),
    [breakdown],
  )

  const hasClaimableInit = claimableInit && Number(claimableInit.total) > 0

  return (
    <Collapsible.Root open={isOpen} onOpenChange={setIsOpen}>
      <Collapsible.Trigger asChild>
        {renderLiquidityRowTrigger({
          isOpen,
          symbol,
          coinLogos,
          singleLogoUrl,
          rightContent: <span className={styles.triggerValue}>{formatValue(totalValue)}</span>,
        })}
      </Collapsible.Trigger>

      <Collapsible.Content className={styles.collapsibleContent}>
        <div className={styles.breakdownContent}>
          {breakdownEntries.map(([type, amount]) => {
            const value = amount * pricePerUnit
            return (
              <div key={type} className={styles.breakdownRow}>
                <span className={styles.breakdownLabel}>{BREAKDOWN_LABELS[type]}</span>
                <div className={styles.breakdownValues}>
                  <span className={styles.breakdownAmount}>
                    {formatNumber(amount, { dp: 6 })} LP
                  </span>
                  <span className={styles.breakdownValue}>{formatValue(value)}</span>
                </div>
              </div>
            )
          })}
          {hasClaimableInit && (
            <div className={styles.breakdownRow}>
              <span className={styles.breakdownLabel}>Claimable rewards</span>
              <div className={styles.breakdownValues}>
                <span className={styles.breakdownAmount}>
                  {formatNumber(Number(claimableInit.total), { dp: 6 })} {INIT_SYMBOL}
                </span>
                <span className={styles.breakdownValue}>
                  {formatValue(claimableInit.totalValue)}
                </span>
              </div>
            </div>
          )}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

const LiquidityRow = ({ row, denomLogoMap }: LiquidityRowProps) => {
  if (row.clamm) {
    return <ClammLiquidityRow row={row} denomLogoMap={denomLogoMap} />
  }

  return <StandardLiquidityRow row={row} denomLogoMap={denomLogoMap} />
}

export default LiquiditySection
