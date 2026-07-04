import clsx from "clsx"
import { Collapsible } from "radix-ui"
import { useState } from "react"
import { IconChevronDown, IconExternalLink } from "@initia/icons-react"
import ExplorerLink from "@/components/ExplorerLink"
import Image from "@/components/Image"
import { INITIA_LIQUIDITY_URL } from "@/data/constants"
import type { VaultPositionRow, VaultSectionData } from "@/data/initia-vault"
import { formatValue } from "@/lib/format"
import styles from "./VaultSection.module.css"

interface VaultSectionProps {
  data: VaultSectionData
  chainId: string
}

const VaultSection = ({ data, chainId }: VaultSectionProps) => {
  const { totalValue, rows } = data

  if (rows.length === 0) return null

  return (
    <div className={styles.container}>
      <section className={styles.section} aria-label="Vault positions">
        <div className={styles.sectionHeader}>
          <a
            href={INITIA_LIQUIDITY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.sectionTitleLink}
            onClick={(e) => e.stopPropagation()}
          >
            <span className={styles.sectionLabel}>Vault</span>
            <IconExternalLink size={14} aria-hidden="true" />
          </a>
          <span className={styles.sectionValue}>{formatValue(totalValue)}</span>
        </div>
        <div className={styles.tokenList}>
          {rows.map((row) => (
            <VaultRow key={row.vaultAddress} row={row} chainId={chainId} />
          ))}
        </div>
      </section>
    </div>
  )
}

const VaultRow = ({ row, chainId }: { row: VaultPositionRow; chainId: string }) => {
  const [isOpen, setIsOpen] = useState(false)
  const { symbol, coinLogos, value, claimableValue, isActive, curatorAddress } = row
  const hasCoinLogos = coinLogos.some((logo) => logo)

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
              {hasCoinLogos && (
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
              )}
              <span className={styles.tokenSymbol}>{symbol}</span>
            </div>
          </div>
          <span className={styles.triggerValue}>{formatValue(value + claimableValue)}</span>
        </button>
      </Collapsible.Trigger>

      <Collapsible.Content className={styles.collapsibleContent}>
        <div className={styles.breakdownContent}>
          <div className={styles.breakdownRow}>
            <span className={styles.breakdownLabel}>Deposit</span>
            <div className={styles.breakdownValues}>
              <span className={styles.breakdownValue}>{formatValue(value)}</span>
            </div>
          </div>
          <div className={styles.breakdownRow}>
            <span className={styles.breakdownLabel}>Status</span>
            <div className={styles.statusValue}>
              <span
                className={clsx(styles.statusDot, isActive ? styles.active : styles.inactive)}
              />
              <span>{isActive ? "Active" : "Inactive"}</span>
            </div>
          </div>
          {curatorAddress && (
            <div className={styles.breakdownRow}>
              <span className={styles.breakdownLabel}>Curator</span>
              <ExplorerLink
                chainId={chainId}
                accountAddress={curatorAddress}
                className={styles.curatorLink}
                showIcon
              />
            </div>
          )}
          <div className={styles.breakdownRow}>
            <span className={styles.breakdownLabel}>Claimable rewards</span>
            <div className={styles.breakdownValues}>
              <span className={styles.breakdownValue}>{formatValue(claimableValue)}</span>
            </div>
          </div>
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

export default VaultSection
