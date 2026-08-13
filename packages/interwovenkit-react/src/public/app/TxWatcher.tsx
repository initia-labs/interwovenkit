import { useEffect } from "react"
import { useAtom } from "jotai"
import { useQueryClient } from "@tanstack/react-query"
import ExplorerLink from "@/components/ExplorerLink"
import { accountQueryKeys } from "@/data/account"
import { useRefreshPortfolio } from "@/data/minity/sse"
import { txStatusAtom } from "@/data/tx"
import { useNotification } from "./NotificationContext"

const TxWatcher = () => {
  const [txStatus, setTxStatus] = useAtom(txStatusAtom)
  const { showNotification, updateNotification, hideNotification } = useNotification()
  const queryClient = useQueryClient()
  const refreshPortfolio = useRefreshPortfolio()

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

    const settleTx = () => {
      queryClient.invalidateQueries({ queryKey: accountQueryKeys.balances._def })
      refreshPortfolio()
      setTxStatus(null)
    }

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
        settleTx()
        break
      case "success":
        updateNotification({
          type: "success",
          title: "Transaction is successful!",
          description,
          autoHide: true,
        })
        settleTx()
        break
    }
  }, [
    txStatus,
    setTxStatus,
    showNotification,
    updateNotification,
    hideNotification,
    queryClient,
    refreshPortfolio,
  ])

  return null
}

export default TxWatcher
