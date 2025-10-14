import { animated, useSpring } from "@react-spring/web"
import { Collapsible } from "radix-ui"
import { useEffect, useRef, useState } from "react"
import { IconChevronDown } from "@initia/icons-react"
import type { PortfolioAssetItem } from "@/data/portfolio"
import { useScrollableRef } from "../ScrollableContext"
import AssetGroup from "./AssetGroup"
import styles from "./UnlistedAssets.module.css"

interface UnlistedAssetsProps {
  unlistedAssets: PortfolioAssetItem[]
}

const UnlistedAssets = ({ unlistedAssets }: UnlistedAssetsProps) => {
  const [isOpen, setIsOpen] = useState(true)
  const scrollableRef = useScrollableRef()

  // Animation for collapsible content using measureRef for auto height
  const contentRef = useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = useState(0)

  useEffect(() => {
    if (contentRef.current) {
      const height = contentRef.current.scrollHeight
      setContentHeight(height)
    }
  }, [unlistedAssets])

  const handleOpenChange = (open: boolean) => {
    if (open && !isOpen && scrollableRef?.current) {
      // Scroll to bottom when reopening
      const container = scrollableRef.current
      container.scrollTo({ top: container.scrollHeight, behavior: "auto" })
      window.setTimeout(() => {
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" })
      }, 150)
    }
    setIsOpen(open)
  }

  const animationStyles = useSpring({
    height: isOpen ? contentHeight : 0,
    opacity: isOpen ? 1 : 0,
    config: { tension: 500, friction: 30, clamp: true },
  })

  if (unlistedAssets.length === 0) {
    return null
  }

  return (
    <Collapsible.Root open={isOpen} onOpenChange={handleOpenChange} className={styles.collapsible}>
      <Collapsible.Trigger className={styles.trigger}>
        <div className={styles.divider} />
        <span className={styles.label}>Unlisted assets ({unlistedAssets.length})</span>
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
            {unlistedAssets.map((assetItem) => (
              <AssetGroup
                assetGroup={{ ...assetItem, assets: [assetItem] }}
                key={assetItem.denom}
              />
            ))}
          </div>
        </animated.div>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

export default UnlistedAssets
