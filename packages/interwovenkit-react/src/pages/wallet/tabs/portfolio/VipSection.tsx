import clsx from "clsx"
import { Collapsible } from "radix-ui"
import { useState } from "react"
import { IconChevronDown, IconExternalLink } from "@initia/icons-react"
import { formatNumber } from "@initia/utils"
import Image from "@/components/Image"
import { INITIA_VIP_URL } from "@/data/constants"
import type { VipPositionRow, VipSectionData } from "@/data/initia-vip"
import { formatValue } from "@/lib/format"
import styles from "./VipSection.module.css"

interface VipSectionProps {
  data: VipSectionData
}

const VipSection = ({ data }: VipSectionProps) => {
  const { totalValue, rows } = data

  if (rows.length === 0) return null

  return (
    <div className={styles.container}>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>
            <span className={styles.sectionLabel}>VIP</span>
            <a
              href={INITIA_VIP_URL}
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
            <VipRow key={`${row.bridgeId}-${row.version}`} row={row} />
          ))}
        </div>
      </div>
    </div>
  )
}

interface VipRowProps {
  row: VipPositionRow
}

const VipRow = ({ row }: VipRowProps) => {
  const { name, logoUrl, lockedReward, lockedRewardValue, claimableReward, claimableRewardValue } =
    row
  const [isOpen, setIsOpen] = useState(false)

  // Calculate total value for this row
  const totalValue = lockedRewardValue + claimableRewardValue

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
              {logoUrl && (
                <Image src={logoUrl} width={20} height={20} className={styles.tokenLogo} logo />
              )}
              <span className={styles.tokenName}>{name}</span>
            </div>
          </div>
          <span className={styles.triggerValue}>{formatValue(totalValue)}</span>
        </button>
      </Collapsible.Trigger>

      <Collapsible.Content className={styles.collapsibleContent}>
        <div className={styles.breakdownContent}>
          {lockedReward > 0 && (
            <div className={styles.breakdownRow}>
              <span className={styles.breakdownLabel}>Locked</span>
              <div className={styles.breakdownValues}>
                <span className={styles.breakdownAmount}>
                  {formatNumber(lockedReward, { dp: 2 })} INIT
                </span>
                <span className={styles.breakdownValue}>{formatValue(lockedRewardValue)}</span>
              </div>
            </div>
          )}
          {claimableReward > 0 && (
            <div className={styles.breakdownRow}>
              <span className={styles.breakdownLabel}>Claimable</span>
              <div className={styles.breakdownValues}>
                <span className={styles.breakdownAmount}>
                  {formatNumber(claimableReward, { dp: 2 })} INIT
                </span>
                <span className={styles.breakdownValue}>{formatValue(claimableRewardValue)}</span>
              </div>
            </div>
          )}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

export default VipSection
