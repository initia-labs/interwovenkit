import Countdown from "./Countdown"
import styles from "./WithdrawalCountdown.module.css"

const WithdrawalCountdown = ({ date }: { date: Date }) => {
  return (
    <div className={styles.container}>
      <span className={styles.title}>Claimable in</span>
      <Countdown date={date} />
    </div>
  )
}

export default WithdrawalCountdown
