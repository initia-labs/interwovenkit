import clsx from "clsx"
import { Collapsible } from "radix-ui"
import { useState } from "react"
import { IconChevronDown, IconExternalLink } from "@initia/icons-react"
import { formatNumber } from "@initia/utils"
import Image from "@/components/Image"
import type { LiquiditySectionData, LiquidityTableRow } from "@/data/minity"
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
              href="https://app.initia.xyz/liquidity/my"
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

const BREAKDOWN_LABELS: Record<keyof LiquidityTableRow["breakdown"], string> = {
  deposit: "Deposited",
  staking: "Staked",
  lockStaking: "Lock staked",
  unstaking: "Unstaking",
}

const LiquidityRow = ({ row, denomLogoMap }: LiquidityRowProps) => {
  const { denom, symbol, totalValue, breakdown, coinLogos, claimableInit } = row
  const [isOpen, setIsOpen] = useState(false)
  const logos = denomLogoMap.get(denom)

  // Calculate value per unit for breakdown value calculation
  const pricePerUnit = row.totalAmount > 0 ? row.totalValue / row.totalAmount : 0

  // Get non-zero breakdown entries
  const breakdownEntries = (Object.entries(breakdown) as [keyof typeof breakdown, number][]).filter(
    ([, amount]) => amount > 0,
  )

  // Check if we have paired coin logos
  const hasCoinLogos = coinLogos && coinLogos.length > 0 && coinLogos.some((logo) => logo)

  // Check if there are claimable rewards
  const hasClaimableInit = claimableInit && Number(claimableInit.total) > 0

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
              {hasCoinLogos ? (
                <div className={styles.pairedLogos}>
                  {coinLogos.map((logo, idx) => (
                    <Image
                      key={idx}
                      src={logo}
                      width={20}
                      height={20}
                      className={styles.coinLogo}
                      logo
                    />
                  ))}
                </div>
              ) : (
                logos?.assetLogo && (
                  <Image
                    src={logos.assetLogo}
                    width={20}
                    height={20}
                    className={styles.tokenLogo}
                  />
                )
              )}
              <span className={styles.tokenSymbol}>{symbol}</span>
            </div>
          </div>
          <span className={styles.triggerValue}>{formatValue(totalValue)}</span>
        </button>
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
              <span className={styles.breakdownLabel}>Unclaimed reward</span>
              <div className={styles.breakdownValues}>
                <span className={styles.breakdownAmount}>
                  {formatNumber(Number(claimableInit.total), { dp: 6 })} INIT
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

export default LiquiditySection
