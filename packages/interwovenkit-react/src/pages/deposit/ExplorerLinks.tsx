import { IconExternalLink } from "@initia/icons-react"
import styles from "./ExplorerLinks.module.css"

interface Props {
  /** External explorer url for the transaction; empty renders no link. */
  explorerUrl?: string
  explorerChainName?: string
  sourceExplorerUrl?: string
  sourceChainName?: string
  deliveryExplorerUrl?: string
  deliveryChainName?: string
  /** In-widget history navigation; omitted renders no history link. */
  onHistoryClick?: () => void
}

const ExplorerLinks = ({
  explorerUrl,
  explorerChainName,
  sourceExplorerUrl,
  sourceChainName,
  deliveryExplorerUrl,
  deliveryChainName,
  onHistoryClick,
}: Props) => {
  const hasExplorer = !!explorerUrl || !!sourceExplorerUrl || !!deliveryExplorerUrl
  if (!hasExplorer && !onHistoryClick) return null

  const isSameChain =
    !!sourceExplorerUrl &&
    !!deliveryExplorerUrl &&
    !!sourceChainName &&
    !!deliveryChainName &&
    sourceChainName.localeCompare(deliveryChainName, undefined, { sensitivity: "base" }) === 0
  const sourceLabel = isSameChain
    ? "View sent transaction"
    : sourceChainName
      ? `View on ${sourceChainName}`
      : "Source"
  const deliveryLabel = isSameChain
    ? "View bridge transaction"
    : deliveryChainName
      ? `View on ${deliveryChainName}`
      : "Delivery"

  return (
    <div className={styles.links}>
      {explorerUrl && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={
            explorerChainName
              ? `View transaction on ${explorerChainName} explorer`
              : "View transaction"
          }
        >
          {explorerChainName ? `View on ${explorerChainName}` : "View transaction"}
        </a>
      )}
      {sourceExplorerUrl && (
        <a
          href={sourceExplorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={
            sourceChainName
              ? isSameChain
                ? `View sent transaction on ${sourceChainName} explorer`
                : `View transaction on ${sourceChainName} explorer`
              : "View source transaction"
          }
        >
          {sourceLabel} <IconExternalLink size={12} aria-hidden="true" />
        </a>
      )}
      {deliveryExplorerUrl && (
        <a
          href={deliveryExplorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={
            deliveryChainName
              ? isSameChain
                ? `View bridge transaction on ${deliveryChainName} explorer`
                : `View transaction on ${deliveryChainName} explorer`
              : "View delivery"
          }
        >
          {deliveryLabel} <IconExternalLink size={12} aria-hidden="true" />
        </a>
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
