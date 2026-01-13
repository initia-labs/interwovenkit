import clsx from "clsx"
import { useRef } from "react"
import { Tabs } from "@base-ui/react/tabs"
import { IconBridge, IconQrCode, IconSend } from "@initia/icons-react"
import Scrollable from "@/components/Scrollable"
import { usePortfolio } from "@/data/portfolio"
import { formatValue } from "@/lib/format"
import { Link, useNavigate, usePath } from "@/lib/router"
import { useClaimableModal } from "@/pages/bridge/op/reminder"
import Activity from "./activity/Activity"
import Assets from "./assets/Assets"
import Nfts from "./nft/Nfts"
import { ScrollableContext } from "./ScrollableContext"
import styles from "./Home.module.css"

const Home = () => {
  useClaimableModal()

  const navigate = useNavigate()
  const path = usePath()
  const { totalValue, isLoading } = usePortfolio()
  const scrollableRef = useRef<HTMLDivElement>(null)

  return (
    <ScrollableContext.Provider value={scrollableRef}>
      <Scrollable ref={scrollableRef}>
        <div className={styles.totalValue}>
          <div className={styles.totalLabel}>Total value</div>
          <div className={clsx(styles.totalAmount, { [styles.loading]: isLoading })}>
            {formatValue(totalValue)}
          </div>
        </div>

        <div className={styles.nav}>
          <Link to="/send" className={styles.item}>
            <IconSend size={16} />
            <span>Send</span>
          </Link>

          <Link to="/bridge" className={styles.item}>
            <IconBridge size={16} />
            <span>Bridge/Swap</span>
          </Link>

          <Link to="/receive" className={styles.item}>
            <IconQrCode size={16} />
            <span>Receive</span>
          </Link>
        </div>

        <Tabs.Root value={path} onValueChange={navigate}>
          <Tabs.List className={styles.tabs}>
            <Tabs.Tab className={styles.tab} value="/">
              Assets
            </Tabs.Tab>

            <Tabs.Tab className={styles.tab} value="/nfts">
              NFTs
            </Tabs.Tab>

            <Tabs.Tab className={styles.tab} value="/activity">
              Activity
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="/">
            <Assets />
          </Tabs.Panel>

          <Tabs.Panel value="/nfts">
            <Nfts />
          </Tabs.Panel>

          <Tabs.Panel value="/activity">
            <Activity />
          </Tabs.Panel>
        </Tabs.Root>
      </Scrollable>
    </ScrollableContext.Provider>
  )
}

export default Home
