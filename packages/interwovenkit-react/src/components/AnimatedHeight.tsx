import { animated, useReducedMotion, useSpring } from "@react-spring/web"
import { useEffect, useRef, useState } from "react"

import type { PropsWithChildren } from "react"

const AnimatedHeight = ({ children }: PropsWithChildren) => {
  const contentRef = useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = useState<number | "auto">(0)
  const [hasInitialized, setHasInitialized] = useState(false)
  const reducedMotion = useReducedMotion()

  const style = useSpring({
    height: contentHeight,
    config: { tension: 500, friction: 30, clamp: true },
    immediate: !hasInitialized || (reducedMotion ?? false),
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

  if (!children) {
    return null
  }

  return (
    <animated.div style={{ overflow: "hidden", ...style }}>
      <div ref={contentRef}>{children}</div>
    </animated.div>
  )
}

export default AnimatedHeight
