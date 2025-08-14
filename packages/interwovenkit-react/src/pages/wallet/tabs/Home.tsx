import clsx from "clsx"
import { useRef } from "react"
import { Tabs } from "@base-ui-components/react/tabs"
import { IconArrowRight, IconSwap } from "@initia/icons-react"
import { Link, useNavigate, usePath } from "@/lib/router"
import { formatValue } from "@/lib/format"
import { usePortfolio } from "@/data/portfolio"
import { useClaimableModal } from "@/pages/bridge/op/reminder"
import Scrollable from "@/components/Scrollable"
import { ScrollableContext } from "./ScrollableContext"
import Assets from "./assets/Assets"
import Nfts from "./nft/Nfts"
import Activity from "./activity/Activity"
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
            <IconArrowRight size={16} />
            <span>Send</span>
          </Link>

          <button className={styles.item} onClick={() => navigate("/bridge")}>
            <IconSwap size={16} />
            <span>Bridge/Swap</span>
          </button>
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
