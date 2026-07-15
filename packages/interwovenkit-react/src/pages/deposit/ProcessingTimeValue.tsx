import { IconWarningFilled } from "@initia/icons-react"
import WidgetTooltip from "@/components/WidgetTooltip"
import type { ProcessingTimeEstimate } from "./data/assets"
import { formatProcessingTime } from "./data/source"
import styles from "./ProcessingTimeValue.module.css"

const UNAVAILABLE_TOOLTIP =
  "We couldn't fetch a processing time estimate right now. Deposits are unaffected and will be processed normally."

interface Props {
  estimate: ProcessingTimeEstimate
}

/**
 * Renders a processing-time estimate value, shared by the deposit-address
 * details row and the cash processing screen: the formatted duration when
 * ready, "Estimating…" while the retry window for a missing estimate is open,
 * and a warning-marked "Unavailable" (with an explanatory tooltip) once it
 * closes. The estimate is informational only, so unavailability is a
 * warning-level cue, not an error.
 */
const ProcessingTimeValue = ({ estimate }: Props) => {
  switch (estimate.status) {
    case "ready":
      return formatProcessingTime(estimate.seconds)
    case "estimating":
      return "Estimating…"
    case "unavailable":
      return (
        <WidgetTooltip label={UNAVAILABLE_TOOLTIP}>
          <span className={styles.unavailable}>
            <IconWarningFilled size={12} aria-hidden="true" />
            Unavailable
          </span>
        </WidgetTooltip>
      )
  }
}

export default ProcessingTimeValue
