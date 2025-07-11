import { useState } from "react"
import { useToggle } from "react-use"
import { IconChevronDown } from "@initia/icons-react"
import { useInterwovenKit } from "@/public/data/hooks"
import Page from "@/components/Page"
import Status from "@/components/Status"
import AsyncBoundary from "@/components/AsyncBoundary"
import CheckboxButton from "@/components/CheckboxButton"
import {
  BRIDGE_HISTORY_ITEMS_PER_PAGE,
  BRIDGE_HISTORY_LIMIT,
  useBridgeHistoryList,
} from "./data/history"
import BridgeHistoryItem from "./BridgeHistoryItem"
import styles from "./BridgeHistory.module.css"

const BridgeHistory = () => {
  const { initiaAddress, hexAddress } = useInterwovenKit()
  const { history, getHistoryDetails } = useBridgeHistoryList()
  const allHistory = history.filter((tx) => getHistoryDetails(tx))
  const myHistory = allHistory.filter((tx) => {
    const details = getHistoryDetails(tx)
    if (!details) return false
    const { values } = details
    const { sender, recipient } = values
    return [sender, recipient].some((address) => [initiaAddress, hexAddress].includes(address))
  })

  const [page, setPage] = useState(1)
  const [showAll, toggleShowAll] = useToggle(!myHistory.length)
  const filteredHistory = showAll ? allHistory : myHistory
  const paginatedHistory = filteredHistory.slice(0, page * BRIDGE_HISTORY_ITEMS_PER_PAGE)

  return (
    <Page title="Bridge/Swap activity">
      <div className={styles.list}>
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
          paginatedHistory.map((tx, index) => (
            <div className={styles.item} key={index}>
              <AsyncBoundary>
                <BridgeHistoryItem tx={tx} />
              </AsyncBoundary>
            </div>
          ))
        )}

        {filteredHistory.length > page * BRIDGE_HISTORY_ITEMS_PER_PAGE ? (
          <button onClick={() => setPage((page) => page + 1)} className={styles.showMore}>
            Show More <IconChevronDown size={14} />
          </button>
        ) : (
          history.length >= BRIDGE_HISTORY_LIMIT && (
            <Status>
              Only the latest {BRIDGE_HISTORY_LIMIT} items are stored. Older entries will be removed
              automatically.
            </Status>
          )
        )}
      </div>
    </Page>
  )
}

export default BridgeHistory
