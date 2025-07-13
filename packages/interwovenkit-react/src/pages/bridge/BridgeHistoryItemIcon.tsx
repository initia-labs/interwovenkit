import { useEffect } from "react"
import type { StatusResponseJson } from "@skip-go/client"
import { IconCheckCircleFilled, IconWarningFilled } from "@initia/icons-react"
import Loader from "@/components/Loader"
import { useTxStatusQuery } from "./data/tx"
import type { TxIdentifier } from "./data/history"
import { useBridgeHistoryDetails } from "./data/history"
import styles from "./BridgeHistoryItem.module.css"

// it should be mounted only after the transaction is tracked

const BridgeHistoryItemIcon = ({ tx }: { tx: TxIdentifier }) => {
  const [details, setDetails] = useBridgeHistoryDetails(tx)
  if (!details) throw new Error("Bridge history details not found")

  const { data: txStatus } = useTxStatusQuery(details)
  const state = details.state ?? getState(txStatus)

  useEffect(() => {
    if (state !== "loading") {
      setDetails((prev) => {
        if (!prev) throw new Error("Bridge history details not found")
        return { ...prev, tracked: true, state }
      })
    }
  }, [setDetails, state])

  switch (state) {
    case "error":
      return (
        <div className={styles.error}>
          <IconWarningFilled size={14} />
        </div>
      )

    case "success":
      return (
        <div className={styles.success}>
          <IconCheckCircleFilled size={14} />
        </div>
      )

    default:
      return <Loader size={14} />
  }
}

export default BridgeHistoryItemIcon

function getState(data?: StatusResponseJson | null) {
  if (!data) return "loading"

  switch (data.state) {
    case "STATE_ABANDONED":
    case "STATE_COMPLETED_ERROR":
    case "STATE_PENDING_ERROR":
      return "error"

    case "STATE_COMPLETED_SUCCESS":
      return "success"

    default:
      return "loading"
  }
}
