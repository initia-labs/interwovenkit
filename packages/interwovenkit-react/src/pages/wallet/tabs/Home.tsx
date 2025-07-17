import { useMemo } from "react"
import { Tabs } from "radix-ui"
import { animated, useTransition } from "@react-spring/web"
import { IconArrowRight, IconSwap } from "@initia/icons-react"
import { Link, useNavigate, usePath, usePreviousPath } from "@/lib/router"
import { useClaimableModal } from "@/pages/bridge/op/reminder"
import Scrollable from "@/components/Scrollable"
import Assets from "./assets/Assets"
import Nfts from "./nft/Nfts"
import Activity from "./activity/Activity"
import styles from "./Home.module.css"

const tabs = [
  { label: "Assets", value: "/", component: <Assets /> },
  { label: "NFTs", value: "/nfts", component: <Nfts /> },
  { label: "Activity", value: "/activity", component: <Activity /> },
]

const Home = () => {
  useClaimableModal()

  const navigate = useNavigate()
  const path = usePath()
  const prevPath = usePreviousPath()

  const direction = useMemo(() => {
    const currentIndex = tabs.findIndex((t) => t.value === path)
    const prevIndex = tabs.findIndex((t) => t.value === prevPath)

    return currentIndex > prevIndex ? 1 : -1
  }, [path, prevPath])

  const skipAnimation = !tabs.find((t) => t.value === prevPath)

  const transitions = useTransition(path, {
    from: { opacity: 0, transform: `translateX(${direction * 100}%)` },
    enter: { opacity: 1, transform: "translateX(0%)" },
    leave: { opacity: 0, transform: `translateX(${direction * -100}%)` },
    config: { tension: 250, friction: 30 },
    immediate: skipAnimation,
  })

  return (
    <Scrollable>
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
          {tabs.map((tab) => (
            <Tabs.Trigger key={tab.value} className={styles.tab} value={tab.value}>
              {tab.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <div style={{ position: "relative" }}>
          {transitions((style, item) => {
            const tab = tabs.find((t) => t.value === item)
            return (
              <Tabs.Content forceMount key={item} value={item} asChild>
                <animated.div style={{ ...style, position: "absolute", width: "100%" }}>
                  {tab?.component}
                </animated.div>
              </Tabs.Content>
            )
          })}
        </div>
      </Tabs.Root>
    </Scrollable>
  )
}

export default Home
