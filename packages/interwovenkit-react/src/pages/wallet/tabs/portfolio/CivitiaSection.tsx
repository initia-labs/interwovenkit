import clsx from "clsx"
import { formatNumber } from "@initia/utils"
import Skeletons from "@/components/Skeletons"
import { useCivitiaPlayer } from "@/data/civitia"
import styles from "./CivitiaSection.module.css"

const CivitiaSection = () => {
  const { data: player, isLoading } = useCivitiaPlayer()

  if (isLoading) {
    return <Skeletons height={36} length={2} />
  }

  const gold = player?.gold_balance ?? 0
  const silver = player?.silver_balance ?? 0

  return (
    <div className={styles.section}>
      {/* Gold Row */}
      <div className={styles.row}>
        <div className={styles.rowLeft}>
          <div className={clsx(styles.rowIcon, styles.goldIcon)} />
          <span className={styles.rowTitle}>Gold</span>
        </div>
        <span className={clsx(styles.rowValue, gold === 0 && styles.rowSubtitle)}>
          {gold === 0 ? "–" : formatNumber(gold, { dp: 6 })}
        </span>
      </div>

      {/* Silver Row */}
      <div className={styles.row}>
        <div className={styles.rowLeft}>
          <div className={clsx(styles.rowIcon, styles.silverIcon)} />
          <span className={styles.rowTitle}>Silver</span>
        </div>
        <span className={clsx(styles.rowValue, silver === 0 && styles.rowSubtitle)}>
          {silver === 0 ? "–" : formatNumber(silver, { dp: 6 })}
        </span>
      </div>
    </div>
  )
}

export default CivitiaSection
