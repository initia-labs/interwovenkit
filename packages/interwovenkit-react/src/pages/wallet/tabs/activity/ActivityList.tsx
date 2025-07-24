import { useInitiaAddress } from "@/public/data/hooks"
import type { NormalizedChain } from "@/data/chains"
import Status from "@/components/Status"
import ExplorerLink from "@/components/ExplorerLink"
import { useTxs } from "./data"
import ActivityItem from "./ActivityItem"
import styles from "./ActivityList.module.css"

const ActivityList = ({ chain }: { chain: NormalizedChain }) => {
  const address = useInitiaAddress()
  const { data: list } = useTxs(chain)

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

      <ExplorerLink
        chainId={chain.chainId}
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
