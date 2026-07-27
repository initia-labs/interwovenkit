import { useEffect, useEffectEvent } from "react"
import { useInView } from "react-intersection-observer"
import { IconChevronDown } from "@initia/icons-react"
import styles from "./LoadMoreButton.module.css"

const LoadMoreButton = ({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) => {
  // Trigger before the button is actually visible so loading feels seamless while
  // scrolling. The button itself always stays rendered and clickable as a fallback
  // for fast scrolls that skip past the margin, reduced-motion settings, or any
  // other case where the intersection observer doesn't fire.
  const { ref, inView } = useInView({ rootMargin: "200px 0px" })

  const onVisible = useEffectEvent(() => {
    if (!disabled) onClick()
  })

  useEffect(() => {
    if (inView) onVisible()
  }, [inView])

  return (
    <button className={styles.button} onClick={onClick} disabled={disabled} ref={ref}>
      <span>Load more</span>
      <IconChevronDown size={12} aria-hidden="true" />
    </button>
  )
}

export default LoadMoreButton
