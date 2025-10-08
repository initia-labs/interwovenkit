import { useMemo } from "react"
import AsyncBoundary from "@/components/AsyncBoundary"
import ExplorerLink from "@/components/ExplorerLink"
import Status from "@/components/Status"
import { groupByDate } from "@/data/date"
import { useInitiaAddress } from "@/public/data/hooks"
import ActivityItem from "./ActivityItem"
import type { ChainActivity } from "./queries"
import styles from "./ActivityList.module.css"

const ActivityList = ({ list, chainId }: { list: ChainActivity[]; chainId: string }) => {
  const address = useInitiaAddress()

  // Group activities by date
  const groupedActivities = useMemo(() => {
    return groupByDate(list, (activity) => {
      if (!activity.timestamp) return undefined
      return new Date(activity.timestamp)
    })
  }, [list])

  if (list.length === 0) return <Status>No activity found</Status>

  return (
    <>
      <div className={styles.list}>
        {Object.entries(groupedActivities).map(([date, items]) => (
          <div className={styles.dateGroup} key={date}>
            <div className={styles.dateHeader}>{date}</div>
            {items.map((item) => (
              <AsyncBoundary errorBoundaryProps={{ fallback: null }} key={item.txhash}>
                <ActivityItem txItem={item} chain={item.chain} />
              </AsyncBoundary>
            ))}
          </div>
        ))}
      </div>

      <ExplorerLink
        chainId={chainId}
        accountAddress={address}
        pathSuffix="/txs"
        className={styles.more}
        showIcon
      >
        View more on Initia Scan
      </ExplorerLink>
    </>
  )
}

export default ActivityList
