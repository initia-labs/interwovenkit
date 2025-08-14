import { version } from "@/../package.json"
import styles from "./Version.module.css"

const Version = () => {
  return <aside className={styles.version}>v{version}</aside>
}

export default Version
