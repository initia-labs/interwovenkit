import { isFuture } from "date-fns"
import ClaimButton from "./ClaimButton"
import WithClaimableDate from "./WithClaimableDate"
import WithdrawalCountdown from "./WithdrawalCountdown"
import WithdrawalSubmitted from "./WithdrawalSubmitted"
import WithIsSubmitted from "./WithIsSubmitted"
import WithUpdateReminder from "./WithUpdateReminder"

const WithdrawalAction = () => {
  return (
    <WithIsSubmitted>
      {(isSubmitted) =>
        isSubmitted ? (
          <WithdrawalSubmitted />
        ) : (
          <WithClaimableDate>
            {(date) =>
              !date ? (
                <WithdrawalSubmitted />
              ) : (
                <WithUpdateReminder date={date}>
                  {isFuture(date) ? <WithdrawalCountdown date={date} /> : <ClaimButton />}
                </WithUpdateReminder>
              )
            }
          </WithClaimableDate>
        )
      }
    </WithIsSubmitted>
  )
}

export default WithdrawalAction
