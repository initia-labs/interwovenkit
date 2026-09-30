import { useMemo, useState } from "react"
import { useToggle } from "usehooks-ts"
import AsyncBoundary from "@/components/AsyncBoundary"
import CheckboxButton from "@/components/CheckboxButton"
import LoadMoreButton from "@/components/LoadMoreButton"
import Page from "@/components/Page"
import Status from "@/components/Status"
import { useConfig } from "@/data/config"
import { groupByDate } from "@/data/date"
import DepositHistoryItem from "@/pages/deposit/DepositHistoryItem"
import { depositHistorySessions, matchesHistoryAccount } from "@/pages/deposit/history"
import { useDepositSessionStore } from "@/pages/deposit/wallet/depositSession"
import { useInterwovenKit } from "@/public/data/hooks"
import {
  BRIDGE_HISTORY_LIMIT,
  BRIDGE_HISTORY_LIMIT_PER_PAGE,
  useBridgeHistoryList,
} from "./data/history"
import BridgeHistoryItem from "./BridgeHistoryItem"
import styles from "./BridgeHistory.module.css"

type HistoryEntry =
  | {
      kind: "skip"
      key: string
      timestamp: number
      sender: string
      recipient: string
      tx: { chainId: string; txHash: string }
    }
  | {
      kind: "deposit"
      key: string
      timestamp: number
      sender: string
      recipient: string
      session: ReturnType<typeof depositHistorySessions>[number]
    }

const BridgeHistory = () => {
  const { initiaAddress, hexAddress } = useInterwovenKit()
  const { depositApiUrl } = useConfig()
  const depositStore = useDepositSessionStore()
  const { history, getHistoryDetails } = useBridgeHistoryList()
  const depositSessions = useMemo(
    () => (depositApiUrl ? depositStore.list(depositApiUrl) : []),
    [depositApiUrl, depositStore],
  )
  const skipHistory = history.flatMap<HistoryEntry>((tx) => {
    const details = getHistoryDetails(tx)
    return details
      ? [
          {
            kind: "skip",
            key: `skip:${tx.chainId}:${tx.txHash}`,
            timestamp: details.timestamp,
            sender: details.values.sender,
            recipient: details.values.recipient,
            tx,
          },
        ]
      : []
  })
  const depositHistory = depositHistorySessions(depositSessions).map<HistoryEntry>((session) => ({
    kind: "deposit",
    key: `deposit:${session.id}`,
    timestamp: session.createdAt,
    sender: session.source.sender,
    recipient: session.destination.recipient,
    session,
  }))
  const allHistory = [...skipHistory, ...depositHistory].sort((a, b) => b.timestamp - a.timestamp)
  const myHistory = allHistory.filter((entry) =>
    matchesHistoryAccount(entry.sender, entry.recipient, [initiaAddress, hexAddress]),
  )

  const [page, setPage] = useState(1)
  const [showAll, toggleShowAll] = useToggle(!myHistory.length)
  const filteredHistory = showAll ? allHistory : myHistory
  const paginatedHistory = filteredHistory.slice(0, page * BRIDGE_HISTORY_LIMIT_PER_PAGE)

  // Group history items by date
  const groupedHistory = useMemo(() => {
    return groupByDate(paginatedHistory, (entry) => new Date(entry.timestamp))
  }, [paginatedHistory])

  return (
    <Page title="Bridge/Swap activity">
      <div className={styles.history}>
        {allHistory.length > 0 && allHistory.length !== myHistory.length && (
          <header className={styles.header}>
            <CheckboxButton
              checked={showAll}
              onClick={toggleShowAll}
              label="Show all transactions stored in this browser"
              className={styles.checkbox}
            />
          </header>
        )}

        {filteredHistory.length === 0 ? (
          <Status>No bridge/swap activity</Status>
        ) : (
          <div className={styles.groups}>
            {Object.entries(groupedHistory).map(([date, items]) => (
              <div className={styles.dateGroup} key={date}>
                <div className={styles.dateHeader}>{date}</div>
                <div className={styles.list}>
                  {items.map((entry) => (
                    <AsyncBoundary key={entry.key}>
                      {entry.kind === "skip" ? (
                        <BridgeHistoryItem tx={entry.tx} />
                      ) : (
                        <DepositHistoryItem session={entry.session} />
                      )}
                    </AsyncBoundary>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {filteredHistory.length > page * BRIDGE_HISTORY_LIMIT_PER_PAGE ? (
          <LoadMoreButton onClick={() => setPage((page) => page + 1)} />
        ) : (
          history.length >= BRIDGE_HISTORY_LIMIT && (
            <Status>
              Only the latest {BRIDGE_HISTORY_LIMIT} Skip bridge/swap items are stored. Older Skip
              entries will be removed automatically.
            </Status>
          )
        )}
      </div>
    </Page>
  )
}

export default BridgeHistory
