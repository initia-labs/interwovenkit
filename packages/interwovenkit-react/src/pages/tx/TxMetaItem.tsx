import type { ReactNode } from "react"
import styles from "./TxMetaItem.module.css"

const TxMetaItem = ({ title, content }: { title: ReactNode; content: ReactNode }) => {
  return (
    <div className={styles.item}>
      <div className={styles.title}>{title}</div>
      <div className={styles.content}>{content}</div>
    </div>
  )
}

export default TxMetaItem
