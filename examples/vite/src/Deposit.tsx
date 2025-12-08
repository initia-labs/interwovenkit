import { useInterwovenKit } from "@initia/interwovenkit-react"
import styles from "./Bridge.module.css"

const Deposit = () => {
  const { address, openDeposit } = useInterwovenKit()

  if (!address) return null

  return (
    <button className={styles.button} onClick={() => openDeposit()}>
      Open deposit
    </button>
  )
}

export default Deposit
