import styles from "./TxMetaItem.module.css"

import type { ReactNode } from "react"

const TxMetaItem = ({ title, content }: { title: ReactNode; content: ReactNode }) => {
  return (
    <div className={styles.item}>
      <div className={styles.title}>{title}</div>
      <div className={styles.content}>{content}</div>
    </div>
  )
}

export default TxMetaItem
