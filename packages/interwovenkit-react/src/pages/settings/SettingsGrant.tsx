import styles from "./SettingsGrant.module.css"
import { formatDuration } from "@/pages/bridge/data/format"
import { useDefaultChain } from "@/data/chains"

interface SettingsGrantProps {
  grantee: string
  expiration: string
}

const SettingsGrant = ({ expiration }: SettingsGrantProps) => {
  const defaultChain = useDefaultChain()

  const handleRevoke = () => {
    // TODO: Implement revoke functionality
  }

  return (
    <div className={styles.container}>
      <div className={styles.textContainer}>
        <div className={styles.chain}>{defaultChain.chainId}</div>
        <div className={styles.expiration}>
          {new Date(expiration).getTime() - Date.now() > 365 * 24 * 60 * 60 * 1000 ? (
            "Until revoked"
          ) : (
            <>
              Expires in{" "}
              <span>
                {formatDuration(Math.floor((new Date(expiration).getTime() - Date.now()) / 1000))}
              </span>
            </>
          )}
        </div>
      </div>

      <button className={styles.revokeButton} onClick={handleRevoke}>
        Revoke
      </button>
    </div>
  )
}

export default SettingsGrant
