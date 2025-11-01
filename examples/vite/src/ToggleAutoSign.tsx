import { useState } from "react"
import { useInterwovenKit } from "@initia/interwovenkit-react"
import styles from "./ToggleAutoSign.module.css"

const ToggleAutoSign = ({ chainId }: { chainId: string }) => {
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
          <span>Auto sign is enabled on {chainId}!</span>
          <button className={styles.button} onClick={() => autoSign.revoke(chainId)}>
            Revoke
          </button>
        </p>
      )}
    </div>
  )
}

export default ToggleAutoSign
