import styles from "./DepositSurface.module.css"

import type { PropsWithChildren } from "react"

/**
 * The rounded gray surface a flow page renders on: background, padding, and
 * corner clipping. Composed per page by each flow's renderPage (Deposit,
 * TransferFlow) rather than by DepositPageTransition itself, so a page hosting
 * a nested flow (the hub's wallet page renders TransferFlow, whose own pages
 * each bring this surface) is not wrapped in a second surface.
 */
const DepositSurface = ({ children }: PropsWithChildren) => {
  return <div className={styles.surface}>{children}</div>
}

export default DepositSurface
