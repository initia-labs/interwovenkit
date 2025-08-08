import { sentenceCase } from "change-case"
import type { TxItemMessage } from "./queries"
import styles from "./ActivityMessages.module.css"

const ActivityMessages = ({ messages }: { messages: TxItemMessage[] }) => {
  return (
    <>
      {messages.slice(0, 3).map((message, index) => (
        <p className={styles.message} key={index}>
          {sentenceCase(message["@type"].split("Msg")[1])}
        </p>
      ))}

      {messages.length > 3 && (
        <footer className={styles.more}>{`+${messages.length - 3} more`}</footer>
      )}
    </>
  )
}

export default ActivityMessages
