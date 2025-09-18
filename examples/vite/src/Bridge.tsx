import { useInterwovenKit } from "@initia/interwovenkit-react"
import styles from "./Bridge.module.css"

const Bridge = () => {
  const { openBridge, createGhostWallet } = useInterwovenKit()
  return (
    <>
      <button className={styles.button} onClick={() => openBridge()}>
        Open bridge
      </button>
      <button className={styles.button} onClick={() => createGhostWallet()}>
        Open ghost wallet
      </button>
    </>
  )
}

export default Bridge
