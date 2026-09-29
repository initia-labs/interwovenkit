import clsx from "clsx"
import { type CSSProperties, useId, useState } from "react"
import {
  IconCheckCircleFilled,
  IconCloseCircleFilled,
  IconWarningFilled,
} from "@initia/icons-react"
import Loader from "@/components/Loader"
import type { ProgressStepStatus } from "./depositProgressLogic"
import styles from "./ProgressSteps.module.css"

const STATUS_LABEL: Record<ProgressStepStatus, string> = {
  done: "done",
  active: "in progress",
  stopped: "stopped",
  failed: "failed",
  pending: "not started",
}

const CONNECTOR_DOTS = 7

// Only a change seen while mounted animates: a screen opened on a finished deposit shows its end state.
function usePreviousSteps(steps: ProgressStepStatus[]): ProgressStepStatus[] {
  const key = steps.join()
  const [trail, setTrail] = useState({ key, current: steps, previous: steps })
  if (trail.key !== key) setTrail({ key, current: steps, previous: trail.current })
  return trail.key === key ? trail.previous : trail.current
}

function describe(steps: ProgressStepStatus[]): string {
  const index = steps.findIndex((status) => status !== "done")
  if (index === -1) return "All steps done"
  return `Step ${index + 1} of ${steps.length} ${STATUS_LABEL[steps[index]]}`
}

// The wallet's own status marks: its Loader while a step runs, then its filled check, close, or
// warning icon.
const ProgressSteps = ({ steps }: { steps: ProgressStepStatus[] }) => {
  const gooId = `goo${useId().replace(/[^\w-]/g, "")}`
  const previous = usePreviousSteps(steps)
  const isComplete = steps.every((status) => status === "done")
  const justCompleted = isComplete && !previous.every((status) => status === "done")

  return (
    <div
      className={clsx(
        styles.progress,
        isComplete && styles.complete,
        justCompleted && styles.justCompleted,
        steps.length > 1 ? styles.merging : styles.single,
      )}
    >
      <ol className={styles.steps} aria-label="Deposit steps">
        {steps.map((status, index) => {
          // The step before this one finished just now, so the connector carries it over.
          const arrived = index > 0 && steps[index - 1] === "done" && previous[index - 1] !== "done"
          return (
            <li
              key={index}
              className={clsx(styles.step, styles[status], arrived && styles.arrived)}
              aria-label={`Step ${index + 1} of ${steps.length}, ${STATUS_LABEL[status]}`}
            >
              {index > 0 && (
                <span className={styles.connector} aria-hidden>
                  {Array.from({ length: CONNECTOR_DOTS }, (_, dot) => (
                    <span key={dot} style={{ "--dot": dot } as CSSProperties} />
                  ))}
                </span>
              )}
              <span className={styles.circle} aria-hidden>
                <span className={styles.spinner}>
                  <Loader size={40} border={3} color="var(--success)" />
                </span>
                <span className={styles.number} data-digit={index + 1}>
                  {index + 1}
                </span>
                <IconCheckCircleFilled size={40} className={clsx(styles.mark, styles.check)} />
                <IconCloseCircleFilled size={40} className={clsx(styles.mark, styles.cross)} />
                <IconWarningFilled size={40} className={clsx(styles.mark, styles.warn)} />
              </span>
            </li>
          )
        })}
      </ol>

      {/* On completion two discs replace the marks, travel together, and fuse through the goo filter. */}
      {steps.length > 1 && (
        <span className={styles.merge} style={{ filter: `url(#${gooId})` }} aria-hidden>
          <span className={styles.drop} />
          <span className={styles.drop} />
        </span>
      )}
      <svg className={styles.defs} aria-hidden>
        <filter id={gooId}>
          <feGaussianBlur in="SourceGraphic" stdDeviation="6" />
          <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9" />
        </filter>
      </svg>

      {/* The kit's filled check, with the check cut through a mask so it can draw itself in. */}
      <svg className={styles.badge} width={48} height={48} viewBox="0 0 16 16" aria-hidden>
        <mask id={`${gooId}-check`}>
          <rect width="16" height="16" fill="white" />
          <path className={styles.checkStroke} d="M5.25 8.16 6.98 9.89 10.75 6.12" pathLength={1} />
        </mask>
        <circle cx="8" cy="8" r="7" fill="currentColor" mask={`url(#${gooId}-check)`} />
      </svg>

      <span className={styles.status} role="status">
        {describe(steps)}
      </span>
    </div>
  )
}

export default ProgressSteps
