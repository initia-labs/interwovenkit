import styles from "./ExplorerLinks.module.css"

interface Props {
  /** External explorer url for the transaction; empty renders no link. */
  explorerUrl?: string
  sourceExplorerUrl?: string
  deliveryExplorerUrl?: string
  /** In-widget history navigation; omitted renders no history link. */
  onHistoryClick?: () => void
}

/**
 * "View transaction | Go to history" link row on the transfer/deposit status
 * screens — shown while pending (to track the transaction) and after
 * completion alike. Either side is optional; nothing renders when both are
 * absent.
 */
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
        <a href={sourceExplorerUrl} target="_blank" rel="noopener noreferrer">
          View source transaction
        </a>
      )}
      {deliveryExplorerUrl && (
        <a href={deliveryExplorerUrl} target="_blank" rel="noopener noreferrer">
          View delivery
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
