import { useInterwovenKit } from "@initia/interwovenkit-react"
import styles from "./GhostWallet.module.css"

const GhostWallet = () => {
  const { ghostWallet } = useInterwovenKit()
  return (
    <div className={styles.container}>
      {!ghostWallet.enabled["interwoven-1"] ? (
        <button className={styles.button} onClick={() => ghostWallet.create("interwoven-1")}>
          Enable ghost wallet
        </button>
      ) : (
        <p className={styles.enabled}>Ghost wallet is enabled!</p>
      )}
    </div>
  )
}

export default GhostWallet
