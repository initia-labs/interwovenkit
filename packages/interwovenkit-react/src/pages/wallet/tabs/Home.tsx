import { useRef } from "react"
import { Tabs } from "@base-ui/react/tabs"
import { IconBridge, IconQrCode, IconSend } from "@initia/icons-react"
import AsyncBoundary from "@/components/AsyncBoundary"
import Scrollable from "@/components/Scrollable"
import Skeleton from "@/components/Skeleton"
import { useL1PositionsTotal } from "@/data/initia-positions-total"
import { useAppchainPositionsBalance, useLiquidAssetsBalance } from "@/data/minity"
import { formatValue } from "@/lib/format"
import { Link, useNavigate, usePath } from "@/lib/router"
import { useClaimableModal } from "@/pages/bridge/op/reminder"
import Activity from "./activity/Activity"
import Nfts from "./nft/Nfts"
import Portfolio from "./portfolio/Portfolio"
import { ScrollableContext } from "./ScrollableContext"
import styles from "./Home.module.css"

/**
 * TotalBalance component - fetches and displays total portfolio value.
 * Uses individual hooks so each can load independently (same as app-v2).
 * Isolated in its own AsyncBoundary so the rest of Home renders immediately.
 */
const TotalBalance = () => {
  const liquidAssetsBalance = useLiquidAssetsBalance()
  const appchainPositionsBalance = useAppchainPositionsBalance()
  const l1PositionsBalance = useL1PositionsTotal()

  const totalBalance = liquidAssetsBalance + l1PositionsBalance + appchainPositionsBalance

  return <div className={styles.totalAmount}>{formatValue(totalBalance)}</div>
}

const Home = () => {
  useClaimableModal()

  const navigate = useNavigate()
  const path = usePath()

  const scrollableRef = useRef<HTMLDivElement>(null)

  return (
    <ScrollableContext.Provider value={scrollableRef}>
      <Scrollable ref={scrollableRef}>
        <div className={styles.totalValue}>
          <div className={styles.totalLabel}>Total value</div>
          <AsyncBoundary
            suspenseFallback={
              <div className={styles.skeletonWrapper}>
                <Skeleton height={48} width={120} />
              </div>
            }
          >
            <TotalBalance />
          </AsyncBoundary>
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
              Portfolio
            </Tabs.Tab>

            <Tabs.Tab className={styles.tab} value="/nfts">
              NFTs
            </Tabs.Tab>

            <Tabs.Tab className={styles.tab} value="/activity">
              Activity
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="/">
            <Portfolio />
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
