import { animated, useTransition } from "@react-spring/web"
import { useMediaQuery } from "usehooks-ts"
import styles from "./DepositPageTransition.module.css"

import type { ReactNode } from "react"

interface Props<Page extends string> {
  page: Page
  /** Renders a page, including its own visual surface where one applies
   * (see DepositSurface). */
  renderPage: (page: Page) => ReactNode
}

/**
 * Cross-fade page transition shared by the form-driven flows (the deposit hub
 * and the wallet transfer flow). The leaving page overlays the entering one
 * absolutely while it fades out. The wrapper is positioning-only: the visual
 * surface belongs to the pages themselves (DepositSurface, composed by each
 * flow's renderPage), so a page hosting a nested flow is not double-wrapped.
 */
const DepositPageTransition = <Page extends string>({ page, renderPage }: Props<Page>) => {
  // Honors prefers-reduced-motion: pages swap instantly instead of fading.
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)")
  const transition = useTransition(page, {
    keys: page,
    from: { opacity: 0 },
    enter: { opacity: 1 },
    leave: { opacity: 0, position: "absolute" as const, inset: 0 },
    config: { tension: 500, friction: 30, clamp: true, duration: 150 },
    immediate: prefersReducedMotion,
  })

  return (
    <div className={styles.container}>
      {transition((style, currentPage) => (
        <animated.div style={style} className={styles.page}>
          {renderPage(currentPage)}
        </animated.div>
      ))}
    </div>
  )
}

export default DepositPageTransition
