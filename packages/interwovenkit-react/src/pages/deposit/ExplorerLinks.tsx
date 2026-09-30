import { IconExternalLink } from "@initia/icons-react"
import styles from "./ExplorerLinks.module.css"

interface Props {
  /** External explorer url for the transaction; empty renders no link. */
  explorerUrl?: string
  sourceExplorerUrl?: string
  deliveryExplorerUrl?: string
  /** In-widget history navigation; omitted renders no history link. */
  onHistoryClick?: () => void
}

const ExplorerLinks = ({
  explorerUrl,
  sourceExplorerUrl,
  deliveryExplorerUrl,
  onHistoryClick,
}: Props) => {
  const hasExplorer = !!explorerUrl || !!sourceExplorerUrl || !!deliveryExplorerUrl
  if (!hasExplorer && !onHistoryClick) return null

  return (
    <div className={styles.links}>
      {explorerUrl && (
        <a href={explorerUrl} target="_blank" rel="noopener noreferrer">
          View transaction
        </a>
      )}
      {sourceExplorerUrl && (
        <a
          href={sourceExplorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View source transaction"
        >
          Source <IconExternalLink size={12} aria-hidden="true" />
        </a>
      )}
      {sourceExplorerUrl && deliveryExplorerUrl && (
        <span className={styles.divider} aria-hidden="true">
          |
        </span>
      )}
      {deliveryExplorerUrl && (
        <a
          href={deliveryExplorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View delivery"
        >
          Delivery <IconExternalLink size={12} aria-hidden="true" />
        </a>
      )}
      {hasExplorer && onHistoryClick && (
        <span className={styles.divider} aria-hidden="true">
          |
        </span>
      )}
      {onHistoryClick && (
        <button type="button" className={styles.link} onClick={onHistoryClick}>
          Go to history
        </button>
      )}
    </div>
  )
}

export default ExplorerLinks
