import { Fragment } from "react"
import { IconChevronRight } from "@initia/icons-react"
import Images from "@/components/Images"
import styles from "./FlowChips.module.css"

import type { ReactNode } from "react"

/** The icon is exactly one of the two: a logo url or a custom node. The
 * `never` halves make "both" and "neither" unrepresentable. */
export type FlowChip = {
  label: string
  text: string
} & (
  | {
      /** Round asset logo rendered as the chip icon — the common case. */
      logoUrl: string
      /** Chain logo badged on the asset logo's bottom-right corner. */
      chainLogoUrl?: string
      icon?: never
    }
  | {
      /** Custom icon node (e.g. FiatFlag) when the icon is not a plain asset
       * logo. */
      icon: ReactNode
      logoUrl?: never
      chainLogoUrl?: never
    }
)

interface Props {
  steps: FlowChip[]
}

/**
 * Labeled asset chips joined by arrows, e.g. "Pay → Buy → Receive" on the
 * processing screen and "You sent → You receive" on the tracking screen.
 */
const FlowChips = ({ steps }: Props) => {
  return (
    <div className={styles.flow}>
      {steps.map((step, index) => (
        <Fragment key={step.label}>
          {index > 0 && <IconChevronRight size={16} className={styles.arrow} aria-hidden="true" />}
          <div className={styles.step}>
            <span className={styles.stepLabel}>{step.label}</span>
            <span className={styles.chip}>
              {step.icon ?? (
                <Images
                  assetLogoUrl={step.logoUrl}
                  chainLogoUrl={step.chainLogoUrl}
                  assetLogoSize={24}
                  chainLogoSize={14}
                  chainLogoOffset={4}
                  className={styles.coin}
                />
              )}
              {step.text}
            </span>
          </div>
        </Fragment>
      ))}
    </div>
  )
}

export default FlowChips
