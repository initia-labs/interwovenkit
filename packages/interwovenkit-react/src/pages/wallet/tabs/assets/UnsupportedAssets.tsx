import { useRef, useEffect, useState } from "react"
import { Collapsible } from "radix-ui"
import { useSpring, animated } from "@react-spring/web"
import { IconChevronDown } from "@initia/icons-react"
import type { AssetGroup as AssetGroupType } from "@/data/portfolio"
import { useScrollableRef } from "../ScrollableContext"
import AssetGroup from "./AssetGroup"
import styles from "./UnsupportedAssets.module.css"

interface UnsupportedAssetsProps {
  unsupportedAssets: AssetGroupType[]
}

const UnsupportedAssets = ({ unsupportedAssets }: UnsupportedAssetsProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const scrollableRef = useScrollableRef()

  // Animation for collapsible content using measureRef for auto height
  const contentRef = useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = useState(0)

  useEffect(() => {
    if (contentRef.current) {
      const height = contentRef.current.scrollHeight
      setContentHeight(height)
    }
  }, [unsupportedAssets])

  // Scroll to bottom when opened
  useEffect(() => {
    if (!isOpen || !scrollableRef?.current) return
    const container = scrollableRef.current
    container.scrollTo({ top: container.scrollHeight, behavior: "auto" })
    const id = window.setTimeout(() => {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" })
    }, 150)
    return () => window.clearTimeout(id)
  }, [isOpen, scrollableRef])
  const animationStyles = useSpring({
    height: isOpen ? contentHeight : 0,
    opacity: isOpen ? 1 : 0,
    config: { tension: 500, friction: 30, clamp: true },
  })

  if (unsupportedAssets.length === 0) {
    return null
  }

  return (
    <Collapsible.Root open={isOpen} onOpenChange={setIsOpen} className={styles.collapsible}>
      <Collapsible.Trigger className={styles.trigger}>
        <div className={styles.divider} />
        <span className={styles.label}>Unsupported assets ({unsupportedAssets.length})</span>
        <IconChevronDown
          className={styles.chevron}
          size={12}
          data-state={isOpen ? "open" : "closed"}
        />
        <div className={styles.divider} />
      </Collapsible.Trigger>

      <Collapsible.Content forceMount asChild>
        <animated.div className={styles.content} style={animationStyles}>
          <div className={styles.list} ref={contentRef}>
            {unsupportedAssets.map((assetGroup) => (
              <AssetGroup assetGroup={assetGroup} key={assetGroup.asset.denom} isUnsupported />
            ))}
          </div>
        </animated.div>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

export default UnsupportedAssets
