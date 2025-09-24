import { useInterwovenKit } from "@initia/interwovenkit-react"
import styles from "./Bridge.module.css"

const Bridge = () => {
  const { openBridge, ghostWallet } = useInterwovenKit()
  return (
    <>
      <button className={styles.button} onClick={() => openBridge()}>
        Open bridge
      </button>
      {!ghostWallet.enabled && (
        <button className={styles.button} onClick={() => ghostWallet.create()}>
          Open ghost wallet
        </button>
      )}
    </>
  )
}

export default Bridge
