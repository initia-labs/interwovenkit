import { useInterwovenKit } from "@initia/interwovenkit-react"
import styles from "./Button.module.css"

const Bridge = () => {
  const { address, openBridge } = useInterwovenKit()

  if (!address) return null

  return (
    <button className={styles.button} onClick={() => openBridge()}>
      Bridge
    </button>
  )
}

export default Bridge
