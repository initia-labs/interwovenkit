import { useCallback, useEffect, useState } from "react"
import WidgetTooltip from "@/components/WidgetTooltip"

const MILLISECONDS_IN_SECOND = 1000
const SECONDS_IN_MINUTE = 60
const MINUTES_IN_HOUR = 60
const HOURS_IN_DAY = 24

const MILLISECONDS_IN_MINUTE = MILLISECONDS_IN_SECOND * SECONDS_IN_MINUTE
const MILLISECONDS_IN_HOUR = MILLISECONDS_IN_MINUTE * MINUTES_IN_HOUR
const MILLISECONDS_IN_DAY = MILLISECONDS_IN_HOUR * HOURS_IN_DAY

interface Props {
  date: Date
}

const Countdown = ({ date }: Props) => {
  const calculateTimeLeft = useCallback(() => {
    const now = new Date().getTime()
    const targetTime = date.getTime()
    const difference = targetTime - now

    if (difference <= 0) {
      return { days: 0, hours: 0, minutes: 0, seconds: 0 }
    }

    const days = Math.floor(difference / MILLISECONDS_IN_DAY)
    const hours = Math.floor((difference % MILLISECONDS_IN_DAY) / MILLISECONDS_IN_HOUR)
    const minutes = Math.floor((difference % MILLISECONDS_IN_HOUR) / MILLISECONDS_IN_MINUTE)
    const seconds = Math.floor((difference % MILLISECONDS_IN_MINUTE) / MILLISECONDS_IN_SECOND)

    return { days, hours, minutes, seconds }
  }, [date])

  const [timeLeft, setTimeLeft] = useState(calculateTimeLeft())

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTimeLeft(calculateTimeLeft())
    }, 1000)

    return () => window.clearInterval(timer)
  }, [calculateTimeLeft, date])

  const formatTime = (time: number) => time.toString().padStart(2, "0")

  const { days, hours, minutes, seconds } = timeLeft

  return (
    <WidgetTooltip label={date.toLocaleString()}>
      <span className="monospace">
        {days}d {formatTime(hours)}h {formatTime(minutes)}m {formatTime(seconds)}s
      </span>
    </WidgetTooltip>
  )
}

export default Countdown
