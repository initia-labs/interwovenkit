import { IconWarningFilled } from "@initia/icons-react"
import styles from "./WebsiteWarning.module.css"

interface WebsiteWarningProps {
  onIgnore: () => void
}

const WebsiteWarning = ({ onIgnore }: WebsiteWarningProps) => {
  return (
    <div className={styles.warning}>
      <IconWarningFilled className={styles.icon} size={12} />
      <p>You are on an unverified website.</p>
      <button onClick={onIgnore}>Ignore</button>
    </div>
  )
}

export default WebsiteWarning
