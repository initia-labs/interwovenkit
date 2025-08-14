import { useMemo } from "react"
import { useInitiaAddress } from "@/public/data/hooks"
import Status from "@/components/Status"
import ExplorerLink from "@/components/ExplorerLink"
import type { ChainActivity } from "./queries"
import ActivityItem from "./ActivityItem"
import styles from "./ActivityList.module.css"

const ActivityList = ({ list, chainId }: { list: ChainActivity[]; chainId: string }) => {
  const address = useInitiaAddress()

  // Group activities by date
  const groupedActivities = useMemo(() => {
    return list.reduce(
      (groups, activity) => {
        const date = new Date(activity.timestamp)
        const dateKey = date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })

        const existingGroup = groups[dateKey] || []
        return {
          ...groups,
          [dateKey]: [...existingGroup, activity],
        }
      },
      {} as Record<string, ChainActivity[]>,
    )
  }, [list])

  if (list.length === 0) return <Status>No activity found</Status>

  return (
    <>
      <div className={styles.list}>
        {Object.entries(groupedActivities).map(([date, items]) => (
          <div className={styles.dateGroup} key={date}>
            <div className={styles.dateHeader}>{date}</div>
            {items.map((item) => (
              <ActivityItem txItem={item} chain={item.chain} key={item.txhash} />
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
