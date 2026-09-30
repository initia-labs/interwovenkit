import { format } from "date-fns"
import xss from "xss"
import { IconArrowDown, IconExternalLink } from "@initia/icons-react"
import { formatAmount } from "@initia/utils"
import { sanitizeLink } from "@/components/explorer"
import Images from "@/components/Images"
import { useModal } from "@/data/ui"
import { DepositProgressObserver } from "./wallet/DepositProgress"
import type { DepositSession } from "./wallet/depositSession"
import { depositHistoryStatus, sourceExplorerUrl } from "./history"
import styles from "@/pages/bridge/BridgeHistoryItem.module.css"

const STATUS_LABEL = {
  pending: "In progress",
  problem: "Needs attention",
  completed: "Completed",
  failed: "Failed",
  refunding: "Refunding",
  refunded: "Refunded",
} as const

const DepositHistoryItem = ({ session }: { session: DepositSession }) => {
  const { openModal } = useModal()
  const status = depositHistoryStatus(session)
  const received = session.received
  const sourceUrl = sourceExplorerUrl(session.source.chainId, session.currentSourceHash)
  const destinationAmount = received
    ? formatAmount(received.amount, { decimals: received.decimals })
    : "—"

  const openStatus = () =>
    openModal("/deposit", {
      localOptions: [{ denom: session.destination.denom, chainId: session.destination.chainId }],
      resumeSessionId: session.id,
      resumeDestinationSymbol: session.destination.symbol,
    })

  return (
    <div className={styles.link}>
      {(status === "pending" ||
        status === "problem" ||
        status === "refunding" ||
        (status === "completed" && !received)) && <DepositProgressObserver session={session} />}
      <header className={styles.header}>
        <button type="button" className={styles.title} onClick={openStatus}>
          <span>{STATUS_LABEL[status]}</span>
          <span className={styles.date}>{format(new Date(session.createdAt), "h:mm a")}</span>
        </button>
        <div className={styles.explorer}>
          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View source transaction"
            >
              Source <IconExternalLink size={12} aria-hidden="true" />
            </a>
          )}
          {session.deliveryExplorerUrl && (
            <>
              <span className={styles.divider} aria-hidden="true" />
              <a
                href={xss(sanitizeLink(session.deliveryExplorerUrl))}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View delivery"
              >
                Delivery <IconExternalLink size={12} aria-hidden="true" />
              </a>
            </>
          )}
        </div>
      </header>

      <button type="button" className={styles.route} onClick={openStatus}>
        <div className={styles.row}>
          <Images
            assetLogoUrl={session.source.assetLogoUrl}
            chainLogoUrl={session.source.chainLogoUrl}
          />
          <div>
            <div className={styles.asset}>
              <span className={styles.amount}>
                {formatAmount(session.source.amount, { decimals: session.source.decimals })}
              </span>
              <span>{session.source.symbol}</span>
            </div>
            <div className={styles.chain}>on {session.source.chainName}</div>
          </div>
        </div>
        <div className={styles.arrow}>
          <IconArrowDown size={12} aria-hidden="true" />
        </div>
        <div className={styles.row}>
          <Images
            assetLogoUrl={session.destination.assetLogoUrl}
            chainLogoUrl={session.destination.chainLogoUrl}
          />
          <div>
            <div className={styles.asset}>
              <span className={styles.amount}>{destinationAmount}</span>
              <span>{session.destination.symbol}</span>
            </div>
            <div className={styles.chain}>on {session.destination.chainName}</div>
          </div>
        </div>
      </button>
    </div>
  )
}

export default DepositHistoryItem
