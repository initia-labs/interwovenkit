import { useMutation } from "@tanstack/react-query"
import { useInterwovenKit } from "@initia/interwovenkit-react"
import styles from "./Inertia.module.css"

const YOUR_ACCOUNT_ID = 1334

const Inertia = () => {
  const { address, requestTxSync, waitForTxConfirmation } = useInterwovenKit()

  const { mutate, data, isPending, error } = useMutation({
    mutationFn: async () => {
      const messages = [
        {
          typeUrl: "/inertia.loan.v1.MsgDeposit",
          value: {
            sender: address,
            accountId: { low: YOUR_ACCOUNT_ID, high: 0, unsigned: false },
            coins: [
              {
                denom: "l2/01a7a1ea004c23bad7ff1772ab739c0818c881faa1e11383ed8d549d0069f617",
                amount: "1000000",
              },
            ],
          },
        },
      ]

      return requestTxSync({ messages })
    },
    onSuccess: async (txHash) => {
      const tx = await waitForTxConfirmation({ txHash })
      // eslint-disable-next-line
      console.log("Transaction:", tx)
    },
  })

  const render = () => {
    if (error) return <div>{error.message}</div>
    if (data) return <div>Transaction hash: {data}</div>
  }

  return (
    <>
      <button className={styles.button} onClick={() => mutate()} disabled={isPending}>
        Deposit
      </button>

      {render()}
    </>
  )
}

export default Inertia
