import type { PropsWithChildren } from "react"
import { useRef, useState, useEffect } from "react"
import { useSpring, animated } from "@react-spring/web"

const AnimatedHeight = ({ children }: PropsWithChildren) => {
  const contentRef = useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = useState(0)

  const style = useSpring({
    height: contentHeight,
    config: { tension: 500, friction: 30, clamp: true },
  })

  useEffect(() => {
    if (contentRef.current) {
      const { height } = contentRef.current.getBoundingClientRect()
      setContentHeight(height)
    }
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
