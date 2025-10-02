import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx"
import { calculateFee, GasPrice } from "@cosmjs/stargate"
import { useEffect, useState } from "react"
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
  const { initiaAddress, requestTxBlock, submitTxBlock, estimateGas } = useInterwovenKit()
  const [directSign, setDirectSign] = useState(false)

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

      if (directSign) {
        // Use submitTxBlock for direct signing without modal
        const gasEstimate = await estimateGas({ messages, memo })
        const fee = calculateFee(gasEstimate, GasPrice.fromString("0.015uinit"))
        const { transactionHash } = await submitTxBlock({ messages, memo, fee })
        return transactionHash
      } else {
        // Use requestTxBlock with modal
        const { transactionHash } = await requestTxBlock({ messages, memo })
        return transactionHash
      }
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

      <div className={styles.checkbox}>
        <label htmlFor="directSign" className={styles.checkboxLabel}>
          <input
            type="checkbox"
            id="directSign"
            checked={directSign}
            onChange={(e) => setDirectSign(e.target.checked)}
          />
          Use direct signing
        </label>
      </div>

      <button type="submit" className={styles.submit} disabled={isPending}>
        Submit
      </button>

      {renderResult()}
    </form>
  )
}

export default Send
