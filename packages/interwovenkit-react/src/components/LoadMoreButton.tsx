import clsx from "clsx"
import { useEffect, useEffectEvent } from "react"
import { useInView } from "react-intersection-observer"
import { IconChevronDown } from "@initia/icons-react"
import Loader from "./Loader"
import { usePageScrollRoot } from "./PageScrollContext"
import styles from "./LoadMoreButton.module.css"

interface Props {
  onClick: () => void
  disabled?: boolean
  className?: string
}

const LoadMoreButton = ({ onClick, disabled, className }: Props) => {
  const scrollRoot = usePageScrollRoot()

  // Trigger before the button is actually visible so loading feels seamless while
  // scrolling. The button itself always stays rendered and clickable as a fallback
  // for fast scrolls that skip past the margin, or any other case where the
  // intersection observer doesn't fire. `root` must be the actual scrollable
  // ancestor: rootMargin only expands the root's own rect, so leaving root as the
  // default viewport would have the intermediate Scrollable container clip the
  // target with no margin, defeating the lookahead entirely.
  const { ref, inView } = useInView({ root: scrollRoot, rootMargin: "200px 0px" })

  const onVisible = useEffectEvent(() => {
    if (!disabled) onClick()
  })

  useEffect(() => {
    if (inView) onVisible()
  }, [inView])

  return (
    <button
      className={clsx(styles.button, className)}
      onClick={onClick}
      disabled={disabled}
      aria-busy={disabled}
      ref={ref}
    >
      <span>Load more</span>
      {disabled ? (
        <Loader color="currentColor" size={12} border={1.5} />
      ) : (
        <IconChevronDown size={12} aria-hidden="true" />
      )}
    </button>
  )
}

export default LoadMoreButton
