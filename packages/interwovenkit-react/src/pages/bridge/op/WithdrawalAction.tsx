import { isFuture } from "date-fns"
import WithIsSubmitted from "./WithIsSubmitted"
import WithdrawalSubmitted from "./WithdrawalSubmitted"
import WithdrawalCountdown from "./WithdrawalCountdown"
import WithClaimableDate from "./WithClaimableDate"
import WithUpdateReminder from "./WithUpdateReminder"
import ClaimButton from "./ClaimButton"

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
