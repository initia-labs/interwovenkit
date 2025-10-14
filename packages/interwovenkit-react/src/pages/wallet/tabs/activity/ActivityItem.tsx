import { format } from "date-fns"
import { IconWarningFilled } from "@initia/icons-react"
import AsyncBoundary from "@/components/AsyncBoundary"
import ExplorerLink from "@/components/ExplorerLink"
import Image from "@/components/Image"
import type { NormalizedChain } from "@/data/chains"
import ActivityChanges from "./ActivityChanges"
import ActivityMessages from "./ActivityMessages"
import type { TxItem } from "./queries"
import styles from "./ActivityItem.module.css"

interface Props {
  txItem: TxItem
  chain: NormalizedChain
}

const ActivityItem = ({ txItem, chain }: Props) => {
  return (
    <ExplorerLink txHash={txItem.txhash} chainId={chain.chainId} className={styles.link}>
      <div className={styles.inner}>
        <div className={styles.header}>
          <div className={styles.time}>
            {txItem.code !== 0 && <IconWarningFilled size={14} className={styles.error} />}
            <span className={styles.timestamp}>{format(new Date(txItem.timestamp), "h:mm a")}</span>
          </div>

          <div className={styles.chainInfo}>
            <Image src={chain.logoUrl} width={12} height={12} logo />
            <span>{chain.name}</span>
          </div>
        </div>

        <div className={styles.content}>
          <div className={styles.messages}>
            <ActivityMessages messages={txItem.tx.body.messages} />
          </div>

          <div className={styles.changes}>
            <AsyncBoundary suspenseFallback={null} errorBoundaryProps={{ fallback: null }}>
              <ActivityChanges {...txItem} chain={chain} />
            </AsyncBoundary>
          </div>
        </div>
      </div>
    </ExplorerLink>
  )
}

export default ActivityItem
