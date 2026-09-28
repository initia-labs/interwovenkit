import clsx from "clsx"
import { type CSSProperties, useState } from "react"
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
const CHECK_PATH = "M4 8.5l2.75 2.75L12 5.5"
const CROSS_PATH = "M5 5l6 6m0-6l-6 6"

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

const ProgressSteps = ({ steps }: { steps: ProgressStepStatus[] }) => {
  const previous = usePreviousSteps(steps)
  const isComplete = steps.every((status) => status === "done")
  const justCompleted = isComplete && !previous.every((status) => status === "done")

  return (
    <div
      className={clsx(
        styles.progress,
        isComplete && styles.complete,
        justCompleted && styles.justCompleted,
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
                <svg className={styles.ring} viewBox="0 0 40 40">
                  <circle className={styles.track} cx="20" cy="20" r="18.5" />
                  <circle className={styles.arc} cx="20" cy="20" r="18.5" pathLength={100} />
                </svg>
                <span className={styles.number}>{index + 1}</span>
                <svg className={styles.mark} viewBox="0 0 16 16">
                  <path d={status === "failed" ? CROSS_PATH : CHECK_PATH} />
                </svg>
              </span>
            </li>
          )
        })}
      </ol>

      <span className={styles.badge} aria-hidden>
        <svg viewBox="0 0 16 16">
          <path d={CHECK_PATH} />
        </svg>
      </span>

      <span className={styles.status} role="status">
        {describe(steps)}
      </span>
    </div>
  )
}

export default ProgressSteps
