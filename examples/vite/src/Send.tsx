import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx"
import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { useMutation } from "@tanstack/react-query"
import { InitiaAddress } from "@initia/utils"
import { useInterwovenKit } from "@initia/interwovenkit-react"
import styles from "./Send.module.css"

interface FormValues {
  recipient: string
  amount: string
  denom: string
  memo: string
}

const Send = () => {
  const { initiaAddress, requestTxSync, waitForTxConfirmation } = useInterwovenKit()

  const { register, setValue, handleSubmit } = useForm({
    defaultValues: { recipient: "", amount: "1000000", denom: "uinit", memo: "" },
  })

  useEffect(() => {
    setValue("recipient", initiaAddress)
  }, [initiaAddress, setValue])

  const { mutate, data, isPending, error } = useMutation({
    mutationFn: async ({ recipient, amount, denom, memo }: FormValues) => {
      const messages = [
        {
          typeUrl: "/cosmos.bank.v1beta1.MsgSend",
          value: MsgSend.fromPartial({
            fromAddress: initiaAddress,
            toAddress: InitiaAddress(recipient).bech32,
            amount: [{ amount, denom }],
          }),
        },
      ]

      const txHash = await requestTxSync({ messages, memo })

      waitForTxConfirmation({ txHash })
        .then((tx) => window.alert(tx.hash))
        .catch((error) => window.alert(error.message))

      return txHash
    },
  })

  const renderResult = () => {
    if (error) return <p className={styles.error}>{error.message}</p>
    if (data) return <pre className={styles.result}>{data}</pre>
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit((values) => mutate(values))}>
      <h2 className={styles.title}>Send</h2>

      <div className={styles.field}>
        <label htmlFor="denom" className={styles.label}>
          Denom
        </label>
        <input id="denom" className={styles.input} {...register("denom")} />
      </div>

      <div className={styles.field}>
        <label htmlFor="amount" className={styles.label}>
          Amount
        </label>
        <input id="amount" className={styles.input} {...register("amount")} />
      </div>

      <div className={styles.field}>
        <label htmlFor="recipient" className={styles.label}>
          Recipient
        </label>
        <input id="recipient" className={styles.input} {...register("recipient")} />
      </div>

      <div className={styles.field}>
        <label htmlFor="memo" className={styles.label}>
          Memo
        </label>
        <input id="memo" className={styles.input} {...register("memo")} />
      </div>

      <button type="submit" className={styles.submit} disabled={isPending}>
        Submit
      </button>

      {renderResult()}
    </form>
  )
}

export default Send
