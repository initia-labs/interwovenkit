import { useState } from "react"
import { useInterwovenKit } from "@initia/interwovenkit-react"
import styles from "./GhostWallet.module.css"

const AutoSign = () => {
  const { autosign, address } = useInterwovenKit()
  const [isCreating, setIsCreating] = useState(false)

  if (!address) return null // Not connected

  const handleSetupAutoSign = async () => {
    try {
      setIsCreating(true)
      await autosign.setup("interwoven-1")
      // Auto sign enabled successfully
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className={styles.container}>
      {autosign.loading ? (
        <p className={styles.enabled}>Loading...</p>
      ) : !autosign.enabled["interwoven-1"] ? (
        <button className={styles.button} onClick={handleSetupAutoSign} disabled={isCreating}>
          {isCreating ? "Setting up auto sign..." : "Enable auto sign"}
        </button>
      ) : (
        <p className={styles.enabled}>Auto sign is enabled!</p>
      )}
    </div>
  )
}

export default AutoSign
