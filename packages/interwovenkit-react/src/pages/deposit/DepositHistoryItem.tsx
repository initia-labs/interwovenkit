import xss from "xss"
import {
  IconCheckCircleFilled,
  IconCloseCircleFilled,
  IconExternalLink,
  IconWarningFilled,
} from "@initia/icons-react"
import { sanitizeLink } from "@/components/explorer"
import Loader from "@/components/Loader"
import { useModal } from "@/data/ui"
import BridgeHistoryCard from "@/pages/bridge/BridgeHistoryCard"
import { DepositProgressObserver } from "./wallet/DepositProgress"
import type { DepositSession } from "./wallet/depositSession"
import { depositHistoryStatus, savedDeliveryExplorerChainName, sourceExplorerUrl } from "./history"
import statusIcons from "./StatusIcons.module.css"
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
  const deliveryChainName = session.deliveryExplorerUrl
    ? savedDeliveryExplorerChainName(session.deliveryExplorerUrl, session.destination.chainName)
    : ""
  const isSameChain =
    !!sourceUrl &&
    !!deliveryChainName &&
    session.source.chainName.localeCompare(deliveryChainName, undefined, {
      sensitivity: "base",
    }) === 0
  const openStatus = () =>
    openModal("/deposit", {
      localOptions: [{ denom: session.destination.denom, chainId: session.destination.chainId }],
      resumeSessionId: session.id,
      resumeDestinationSymbol: session.destination.symbol,
    })

  return (
    <>
      {(status === "pending" ||
        status === "problem" ||
        status === "refunding" ||
        (status === "completed" && !received)) && <DepositProgressObserver session={session} />}
      <BridgeHistoryCard
        timestamp={session.createdAt}
        action={
          <button
            type="button"
            onClick={openStatus}
            aria-label={`View deposit status: ${STATUS_LABEL[status]}`}
          />
        }
        status={
          <>
            <span role="img" aria-label={STATUS_LABEL[status]}>
              {status === "pending" || status === "refunding" ? (
                <Loader size={14} />
              ) : status === "completed" ? (
                <IconCheckCircleFilled size={14} className={statusIcons.successIcon} />
              ) : status === "problem" ? (
                <IconWarningFilled size={14} className={statusIcons.warningIcon} />
              ) : (
                <IconCloseCircleFilled size={14} className={statusIcons.failIcon} />
              )}
            </span>
            {(status === "problem" || status === "refunding" || status === "refunded") && (
              <span>{STATUS_LABEL[status]}</span>
            )}
          </>
        }
        explorer={
          <>
            {sourceUrl && (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={
                  isSameChain
                    ? `View sent transaction on ${session.source.chainName} explorer`
                    : `View transaction on ${session.source.chainName} explorer`
                }
              >
                {isSameChain ? "View sent transaction" : `View on ${session.source.chainName}`}{" "}
                <IconExternalLink size={12} aria-hidden="true" />
              </a>
            )}
            {session.deliveryExplorerUrl && (
              <>
                {sourceUrl && <span className={styles.divider} aria-hidden="true" />}
                <a
                  href={xss(sanitizeLink(session.deliveryExplorerUrl))}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={
                    isSameChain
                      ? `View bridge transaction on ${deliveryChainName} explorer`
                      : `View transaction on ${deliveryChainName} explorer`
                  }
                >
                  {isSameChain ? "View bridge transaction" : `View on ${deliveryChainName}`}{" "}
                  <IconExternalLink size={12} aria-hidden="true" />
                </a>
              </>
            )}
          </>
        }
        source={{
          ...session.source,
          address: session.source.sender,
        }}
        destination={{
          ...session.destination,
          amount: received?.amount,
          decimals: received?.decimals ?? session.destination.decimals ?? 0,
          address: session.destination.recipient,
        }}
      />
    </>
  )
}

export default DepositHistoryItem
