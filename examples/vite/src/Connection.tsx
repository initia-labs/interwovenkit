import { useInterwovenKit } from "@initia/interwovenkit-react"
import { truncate } from "@initia/utils"
import styles from "./Connection.module.css"

const Connection = () => {
  const { address, username, openConnect, openWallet } = useInterwovenKit()

  if (!address) {
    return (
      <button className={styles.button} onClick={openConnect}>
        Connect
      </button>
    )
  }

  return (
    <button className={styles.button} onClick={openWallet}>
      {truncate(username ?? address)}
    </button>
  )
}

export default Connection
