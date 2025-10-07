import { useEffect, useMemo } from "react"
import AsyncBoundary from "@/components/AsyncBoundary"
import LoadMoreButton from "@/components/LoadMoreButton"
import Status from "@/components/Status"
import type { NormalizedChain } from "@/data/chains"
import { OpWithdrawalContext } from "./context"
import { useWithdrawals } from "./data"
import { useClaimableReminders } from "./reminder"
import WithdrawalAction from "./WithdrawalAction"
import WithdrawalAsset from "./WithdrawalAsset"
import styles from "./WithdrawalList.module.css"

const WithdrawalList = ({ chain }: { chain: NormalizedChain }) => {
  const executorUrl = chain.metadata?.executor_uri
  if (!executorUrl) throw new Error("Executor URL is not defined")

  const { data, fetchNextPage, hasNextPage, isFetching } = useWithdrawals(executorUrl)
  const list = useMemo(() => data?.pages.flat() ?? [], [data])

  const { syncReminders } = useClaimableReminders()
  useEffect(() => {
    const txs = list.map((withdrawalTx) => ({
      chainId: chain.chainId,
      txHash: withdrawalTx.tx_hash,
    }))
    syncReminders(txs)
  }, [chain.chainId, list, syncReminders])

  if (!list.length) {
    return <Status>No withdrawals</Status>
  }

  return (
    <>
      {list.map((withdrawalTx) => {
        const { amount } = withdrawalTx
        return (
          <div className={styles.item} key={withdrawalTx.sequence}>
            <WithdrawalAsset {...amount} />

            <AsyncBoundary suspenseFallback={null}>
              <OpWithdrawalContext.Provider value={{ chainId: chain.chainId, withdrawalTx }}>
                <WithdrawalAction />
              </OpWithdrawalContext.Provider>
            </AsyncBoundary>
          </div>
        )
      })}

      {hasNextPage && <LoadMoreButton onClick={() => fetchNextPage()} disabled={isFetching} />}
    </>
  )
}

export default WithdrawalList
