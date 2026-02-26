import { useEffect, useState } from "react"
import { IconRefresh } from "@initia/icons-react"
import WidgetTooltip from "@/components/WidgetTooltip"
import styles from "./QuoteRefreshIndicator.module.css"

interface Props {
  refreshMs: number
  dataUpdatedAt: number
  isFetching: boolean
  onRefresh: () => void
}

function calcRemaining(dataUpdatedAt: number, refreshSeconds: number) {
  if (!dataUpdatedAt) return refreshSeconds
  const elapsed = (Date.now() - dataUpdatedAt) / 1000
  return Math.max(0, Math.ceil(refreshSeconds - elapsed))
}

const QuoteRefreshIndicator = ({ refreshMs, dataUpdatedAt, isFetching, onRefresh }: Props) => {
  const refreshSeconds = refreshMs / 1000

  const remaining = useSyncCountdown(dataUpdatedAt, refreshSeconds)

  const label = isFetching
    ? "Refreshing quote\u2026"
    : `Refreshing in ${remaining}s. Click to refresh now.`

  return (
    <WidgetTooltip label={label}>
      <button type="button" className={styles.refresh} onClick={onRefresh} disabled={isFetching}>
        <IconRefresh size={12} className={isFetching ? styles.spinning : undefined} />
        <span className={styles.countdown}>{remaining}s</span>
      </button>
    </WidgetTooltip>
  )
}

function useSyncCountdown(dataUpdatedAt: number, refreshSeconds: number) {
  const [, setTick] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), 1000)
    return () => window.clearInterval(timer)
  }, [dataUpdatedAt])

  return calcRemaining(dataUpdatedAt, refreshSeconds)
}

export default QuoteRefreshIndicator
