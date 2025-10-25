import { useState } from "react"
import { useInterwovenKit } from "@initia/interwovenkit-react"
import styles from "./GhostWallet.module.css"

const AutoSign = ({ chainId }: { chainId: string }) => {
  const { autoSign, address } = useInterwovenKit()
  const [isCreating, setIsCreating] = useState(false)

  if (!address) return null // Not connected

  const handleSetupAutoSign = async () => {
    try {
      setIsCreating(true)
      await autoSign.setup(chainId)
      // Auto sign enabled successfully
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className={styles.container}>
      {autoSign.isLoading ? (
        <p className={styles.enabled}>Loading...</p>
      ) : !autoSign.isEnabled[chainId] ? (
        <button className={styles.button} onClick={handleSetupAutoSign} disabled={isCreating}>
          {isCreating ? "Setting up auto sign..." : `Enable auto sign on ${chainId}`}
        </button>
      ) : (
        <p className={styles.enabled}>
          Auto sign is enabled on {chainId}! <button onClick={autoSign.openRevoke}>Revoke</button>
        </p>
      )}
    </div>
  )
}

export default AutoSign
