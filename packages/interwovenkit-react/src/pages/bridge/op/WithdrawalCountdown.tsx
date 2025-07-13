import Countdown from "./Countdown"
import styles from "./WithdrawalCountdown.module.css"

const WithdrawalCountdown = ({ date }: { date: Date }) => {
  return (
    <div className={styles.container}>
      <div className={styles.title}>Claimable in</div>
      <Countdown date={date} />
    </div>
  )
}

export default WithdrawalCountdown
