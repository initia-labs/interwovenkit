import { animated, useSpring } from "@react-spring/web"
import { useEffect, useRef, useState } from "react"

import type { PropsWithChildren } from "react"

const AnimatedHeight = ({ children }: PropsWithChildren) => {
  const contentRef = useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = useState<number | "auto">(0)
  const [hasInitialized, setHasInitialized] = useState(false)

  const isCollapsed = contentHeight === 0
  const style = useSpring({
    height: contentHeight,
    opacity: isCollapsed ? 0 : 1,
    config: { tension: 500, friction: 30, clamp: true },
    immediate: !hasInitialized,
  })

  useEffect(() => {
    const element = contentRef.current
    if (!element) return

    const updateHeight = () => {
      const { height } = element.getBoundingClientRect()
      setContentHeight(height)
      setHasInitialized(true)
    }

    updateHeight()

    const resizeObserver = new ResizeObserver(updateHeight)
    resizeObserver.observe(element)

    return () => resizeObserver.disconnect()
  }, [children])

  return (
    <animated.div style={{ overflow: "hidden", ...style }}>
      <div ref={contentRef}>{children}</div>
    </animated.div>
  )
}

export default AnimatedHeight
