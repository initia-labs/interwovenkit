import { useState } from "react"
import { useInterwovenKit } from "@initia/interwovenkit-react"
import styles from "./GhostWallet.module.css"

const GhostWallet = () => {
  const { ghostWallet, address } = useInterwovenKit()
  const [isCreating, setIsCreating] = useState(false)

  if (!address) return null // Not connected

  const handleCreateGhostWallet = async () => {
    try {
      setIsCreating(true)
      await ghostWallet.create("interwoven-1")
      // Ghost wallet created successfully
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className={styles.container}>
      {ghostWallet.loading ? (
        <p className={styles.enabled}>Loading...</p>
      ) : !ghostWallet.enabled["interwoven-1"] ? (
        <button className={styles.button} onClick={handleCreateGhostWallet} disabled={isCreating}>
          {isCreating ? "Creating ghost wallet..." : "Enable ghost wallet"}
        </button>
      ) : (
        <p className={styles.enabled}>Ghost wallet is enabled!</p>
      )}
    </div>
  )
}

export default GhostWallet
