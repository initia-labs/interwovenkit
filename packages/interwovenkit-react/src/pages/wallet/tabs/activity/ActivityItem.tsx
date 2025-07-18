import { intlFormatDistance } from "date-fns"
import { sentenceCase } from "change-case"
import { IconWarningFilled } from "@initia/icons-react"
import type { NormalizedChain } from "@/data/chains"
import AsyncBoundary from "@/components/AsyncBoundary"
import ExplorerLink from "@/components/ExplorerLink"
import type { TxItem } from "./data"
import ActivityMessages from "./ActivityMessages"
import ActivityChanges from "./ActivityChanges"
import styles from "./ActivityItem.module.css"

interface Props {
  txItem: TxItem
  chain: NormalizedChain
}

const ActivityItem = ({ txItem, chain }: Props) => {
  return (
    <ExplorerLink txHash={txItem.txhash} chainId={chain.chainId} className={styles.link}>
      <div className={styles.inner}>
        <div className={styles.timestamp}>
          {sentenceCase(
            intlFormatDistance(new Date(txItem.timestamp), new Date(), { locale: "en-US" }),
          )}
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

        {txItem.code !== 0 && (
          <div className={styles.error}>
            <IconWarningFilled size={12} />
            <span>Failed</span>
          </div>
        )}
      </div>
    </ExplorerLink>
  )
}

export default ActivityItem
