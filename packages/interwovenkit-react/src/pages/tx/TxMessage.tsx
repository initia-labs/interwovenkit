import type { EncodeObject } from "@cosmjs/proto-signing"
import { stringifyValue } from "./stringify"
import MsgExecuteArgs from "./MsgExecuteArgs"
import styles from "./TxMessage.module.css"

interface Props {
  message: EncodeObject
  chainId: string
}

const TxMessage = ({ message, chainId }: Props) => {
  const { typeUrl, value } = message
  return (
    <div className={styles.list}>
      {Object.entries(value).map(([key, content]) => (
        <div key={key}>
          <div className={styles.key}>{key}</div>
          <div className={styles.value}>
            {typeUrl === "/initia.move.v1.MsgExecute" && key === "args" ? (
              <MsgExecuteArgs msg={value} chainId={chainId} fallback={stringifyValue(content)} />
            ) : (
              stringifyValue(content)
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export default TxMessage
