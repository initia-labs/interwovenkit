import { isPast } from "date-fns"
import { toBase64 } from "@cosmjs/encoding"
import type { PropsWithChildren } from "react"
import { useEffect } from "react"
import { computeWithdrawalHash, useWithdrawalClaimed } from "./data"
import { useOpWithdrawal } from "./context"
import { useClaimableReminders } from "./reminder"

interface Props {
  date: Date
}

const WithUpdateReminder = ({ date, children }: PropsWithChildren<Props>) => {
  const { chainId, withdrawalTx } = useOpWithdrawal()
  const withdrawalHash = toBase64(computeWithdrawalHash(withdrawalTx))
  const claimed = useWithdrawalClaimed(withdrawalTx, withdrawalHash)
  const { setReminder, removeReminder } = useClaimableReminders()

  useEffect(() => {
    const tx = { chainId, txHash: withdrawalTx.tx_hash }
    if (claimed) {
      removeReminder(tx)
    } else {
      // Create if not exists. Update if already exists.
      setReminder(tx, {
        ...tx,
        recipient: withdrawalTx.to,
        claimableAt: date.getTime(),
        amount: withdrawalTx.amount.amount,
        denom: withdrawalTx.amount.denom,
        // Required to show the red dot even if the modal is not shown
        dismissed: isPast(date.getTime()) ? true : undefined,
      })
    }
  }, [chainId, claimed, date, removeReminder, setReminder, withdrawalTx])

  return children
}

export default WithUpdateReminder
