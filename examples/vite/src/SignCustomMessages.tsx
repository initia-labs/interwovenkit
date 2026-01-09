import { useMutation } from "@tanstack/react-query"
import { Msg } from "@initia/initia.js"
import { useInterwovenKit } from "@initia/interwovenkit-react"
import styles from "./SignCustomMessages.module.css"

const MESSAGES_FROM_ANVIL = {
  messages: [
    {
      "@type": "/cosmos.bank.v1beta1.MsgSend",
      authority: "...",
      params: {},
    },
  ],
}

function toEncodeObject(msg: Msg) {
  const data = msg.toData()
  return {
    typeUrl: data["@type"],
    value: msg.toProto(),
  }
}

const SignCustomMessages = () => {
  const { initiaAddress, submitTxBlock, estimateGas } = useInterwovenKit()

  const executeMessage = {
    "@type": "/opinit.opchild.v1.MsgExecuteMessages",
    sender: initiaAddress,
    ...MESSAGES_FROM_ANVIL,
  }

  const messages = [toEncodeObject(Msg.fromData(executeMessage as Msg.Data))]

  const { mutate, data, isPending, error } = useMutation({
    mutationFn: async () => {
      const gasEstimate = await estimateGas({ messages })
      const fee = { amount: [], gas: String(gasEstimate) }
      return await submitTxBlock({ messages, fee })
    },
  })

  const render = () => {
    if (error) return <div>{error.message}</div>
    if (data) return <div>Transaction hash: {data.transactionHash}</div>
  }

  return (
    <>
      <pre>{JSON.stringify(MESSAGES_FROM_ANVIL, null, 2)}</pre>

      <button className={styles.button} onClick={() => mutate()} disabled={isPending}>
        Submit
      </button>

      {render()}
    </>
  )
}

export default SignCustomMessages
