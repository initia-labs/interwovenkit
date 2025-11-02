import { usePrivy } from "@privy-io/react-auth"
import { useInterwovenKit } from "@initia/interwovenkit-react"
import { truncate } from "@initia/utils"
import ToggleAutoSign from "./ToggleAutoSign"
import styles from "./Connection.module.css"

const Connection = () => {
  const { address, username, openWallet } = useInterwovenKit()
  const { login } = usePrivy()

  if (!address) {
    return (
      <button className={styles.button} onClick={login}>
        Connect
      </button>
    )
  }

  return (
    <>
      <ToggleAutoSign />
      <button className={styles.button} onClick={openWallet}>
        {truncate(username ?? address)}
      </button>
    </>
  )
}

export default Connection
