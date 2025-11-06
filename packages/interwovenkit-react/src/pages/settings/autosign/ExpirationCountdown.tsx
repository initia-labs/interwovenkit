import { differenceInSeconds } from "date-fns"
import { useState } from "react"
import { useInterval } from "usehooks-ts"
import styles from "./ExpirationCountdown.module.css"

interface ExpirationCountdownProps {
  expiration: Date
}

const ExpirationCountdown = ({ expiration }: ExpirationCountdownProps) => {
  const calculateTimeLeft = () => {
    const now = new Date()
    const secondsLeft = differenceInSeconds(expiration, now)

    const days = Math.floor(secondsLeft / (24 * 60 * 60))
    const hours = Math.floor((secondsLeft % (24 * 60 * 60)) / (60 * 60))
    const minutes = Math.floor((secondsLeft % (60 * 60)) / 60)
    const seconds = secondsLeft % 60

    const parts: string[] = []
    if (days > 0) parts.push(`${days}d`)
    if (hours > 0 || days > 0) parts.push(`${hours}h`)
    if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`)
    parts.push(`${seconds}s`)

    return parts.join(" ")
  }

  const [timeLeft, setTimeLeft] = useState(calculateTimeLeft())

  useInterval(() => {
    setTimeLeft(calculateTimeLeft())
  }, 1000)

  return <span className={styles.countdown}>{timeLeft}</span>
}

export default ExpirationCountdown
