import clsx from "clsx"
import { useEffect, useEffectEvent } from "react"
import { useInView } from "react-intersection-observer"
import { IconChevronDown } from "@initia/icons-react"
import Loader from "./Loader"
import { usePageScrollRoot } from "./PageScrollContext"
import styles from "./LoadMoreButton.module.css"

interface Props {
  onClick: () => void
  isLoading?: boolean
  className?: string
}

const LoadMoreButton = ({ onClick, isLoading, className }: Props) => {
  const scrollRoot = usePageScrollRoot()

  // Load ahead of the button becoming visible so scrolling feels seamless. `root` must be
  // the actual scrollable ancestor: rootMargin only expands the root's own rect, while
  // intermediate scroll containers clip the target with no margin. Left at the default
  // viewport root, the enclosing Scrollable would clip it and the lookahead would be lost.
  const { ref, inView } = useInView({ root: scrollRoot, rootMargin: "200px 0px" })

  const onVisible = useEffectEvent(() => {
    if (!isLoading) onClick()
  })

  // Only inView transitions load a page, so once a page is too short to push the button
  // past the margin band, inView stays true and auto-loading stops. Clicking takes over
  // from there, which is also what keeps a tail of short pages from loading all at once.
  useEffect(() => {
    if (inView) onVisible()
  }, [inView])

  return (
    <button
      className={clsx(styles.button, className)}
      // The click is guarded here rather than blocked by the disabled attribute: a disabled
      // button drops keyboard focus to the body mid-load, and its aria-busy and the Loader's
      // live region stop being announced.
      onClick={() => {
        if (!isLoading) onClick()
      }}
      aria-disabled={isLoading}
      aria-busy={isLoading}
      ref={ref}
    >
      <span>Load more</span>
      {isLoading ? (
        <Loader color="currentColor" size={12} border={1.5} />
      ) : (
        <IconChevronDown size={12} aria-hidden="true" />
      )}
    </button>
  )
}

export default LoadMoreButton
