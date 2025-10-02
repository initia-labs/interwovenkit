import { useInterwovenKit } from "@initia/interwovenkit-react"
import styles from "./Bridge.module.css"

const Bridge = () => {
  const { openBridge, ghostWallet } = useInterwovenKit()
  return (
    <>
      <button className={styles.button} onClick={() => openBridge()}>
        Open bridge
      </button>
      {!ghostWallet.enabled["interwoven-1"] && (
        <button className={styles.button} onClick={() => ghostWallet.create("interwoven-1")}>
          Open ghost wallet
        </button>
      )}
    </>
  )
}

export default Bridge
