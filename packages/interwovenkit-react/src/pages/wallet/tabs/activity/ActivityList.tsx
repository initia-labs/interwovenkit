import type { NormalizedChain } from "@/data/chains"
import { parsePaginatedResponse } from "@/data/pagination"
import Status from "@/components/Status"
import LoadMoreButton from "@/components/LoadMoreButton"
import { useTxs } from "./data"
import ActivityItem from "./ActivityItem"
import styles from "./ActivityList.module.css"

const ActivityList = ({ chain }: { chain: NormalizedChain }) => {
  const { data: activity, hasNextPage, isFetching, fetchNextPage } = useTxs(chain)
  const { list } = parsePaginatedResponse("txs", activity)

  if (!list.length) {
    return <Status>No activity yet</Status>
  }

  return (
    <>
      <div className={styles.list}>
        {list.map((item) => (
          <ActivityItem txItem={item} chain={chain} key={item.txhash} />
        ))}
      </div>

      {hasNextPage && <LoadMoreButton onClick={() => fetchNextPage()} disabled={isFetching} />}
    </>
  )
}

export default ActivityList
