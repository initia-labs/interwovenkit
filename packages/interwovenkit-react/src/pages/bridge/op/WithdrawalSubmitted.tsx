import { IconInfoFilled } from "@initia/icons-react"
import WidgetTooltip from "@/components/WidgetTooltip"
import styles from "./WithdrawalSubmitted.module.css"

const DESCRIPTION = "Withdrawal will begin within an hour"

const WithdrawalSubmitted = () => {
  return (
    <div className={styles.container}>
      <span>In progress</span>
      <WidgetTooltip label={DESCRIPTION}>
        <span className={styles.icon}>
          <IconInfoFilled size={12} />
        </span>
      </WidgetTooltip>
    </div>
  )
}

export default WithdrawalSubmitted
