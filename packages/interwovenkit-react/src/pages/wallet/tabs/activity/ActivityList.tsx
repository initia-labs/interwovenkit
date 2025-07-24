import type { NormalizedChain } from "@/data/chains"
import { useInitiaAddress } from "@/public/data/hooks"
import Status from "@/components/Status"
import ExplorerLink from "@/components/ExplorerLink"
import { IconExternalLink } from "@initia/icons-react"
import { useTxs } from "./data"
import ActivityItem from "./ActivityItem"
import styles from "./ActivityList.module.css"

const ActivityList = ({ chain }: { chain: NormalizedChain }) => {
  const address = useInitiaAddress()
  const { data: activity } = useTxs(chain)
  const list = activity?.txs ?? []

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
        suffixPath="/txs"
        className={styles.viewMoreButton}
      >
        View more on Initia Scan
        <IconExternalLink size={12} />
      </ExplorerLink>
    </>
  )
}

export default ActivityList
