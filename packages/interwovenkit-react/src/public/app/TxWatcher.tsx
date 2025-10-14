import { useEffect } from "react"
import { useAtom } from "jotai"
import ExplorerLink from "@/components/ExplorerLink"
import { txStatusAtom } from "@/data/tx"
import { useNotification } from "./NotificationContext"

const TxWatcher = () => {
  const [txStatus, setTxStatus] = useAtom(txStatusAtom)
  const { showNotification, updateNotification, hideNotification } = useNotification()

  useEffect(() => {
    if (!txStatus) return

    const { status, chainId, txHash, error } = txStatus

    const description = error ? (
      error.message
    ) : txHash ? (
      <ExplorerLink txHash={txHash} chainId={chainId} onClick={hideNotification} showIcon>
        View on Initia Scan
      </ExplorerLink>
    ) : null

    switch (status) {
      case "loading":
        showNotification({
          type: "loading",
          title: "Transaction is pending...",
        })
        break
      case "error":
        updateNotification({
          type: "error",
          title: "Transaction failed",
          description,
        })
        setTxStatus(null)
        break
      case "success":
        updateNotification({
          type: "success",
          title: "Transaction is successful!",
          description,
          autoHide: true,
        })
        setTxStatus(null)
        break
    }
  }, [txStatus, setTxStatus, showNotification, updateNotification, hideNotification])

  return null
}

export default TxWatcher
