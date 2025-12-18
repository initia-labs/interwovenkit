import { animated, useSpring } from "@react-spring/web"
import { Collapsible } from "radix-ui"
import { useEffect, useMemo, useRef, useState } from "react"
import { IconChevronDown } from "@initia/icons-react"
import type { PortfolioAssetGroup, PortfolioAssetItem } from "@/data/portfolio"
import { useScrollableRef } from "../ScrollableContext"
import AssetGroup from "./AssetGroup"
import styles from "./UnlistedAssets.module.css"

interface UnlistedAssetsProps {
  unlistedAssets: PortfolioAssetItem[]
}

const UnlistedAssets = ({ unlistedAssets }: UnlistedAssetsProps) => {
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
  }, [unlistedAssets])

  const triggerRef = useRef<HTMLButtonElement>(null)

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)

    // Scroll into view if expanded content would be outside viewport
    if (open && triggerRef.current && scrollableRef?.current) {
      window.setTimeout(() => {
        if (!triggerRef.current || !contentRef.current || !scrollableRef?.current) return

        const container = scrollableRef.current
        const containerRect = container.getBoundingClientRect()
        const triggerRect = triggerRef.current.getBoundingClientRect()
        const expandedHeight = contentRef.current.scrollHeight

        // Check if the bottom of expanded content would be outside the viewport
        const expandedBottom = triggerRect.bottom + expandedHeight
        if (expandedBottom > containerRect.bottom) {
          // Scroll so the trigger is near the top of the viewport
          const scrollTop = triggerRect.top - containerRect.top + container.scrollTop - 16
          container.scrollTo({ top: scrollTop, behavior: "smooth" })
        }
      }, 50)
    }
  }

  const animationStyles = useSpring({
    height: isOpen ? contentHeight : 0,
    opacity: isOpen ? 1 : 0,
    config: { tension: 500, friction: 30, clamp: true },
  })

  // Pre-compute asset groups to avoid object creation during render
  const assetGroups = useMemo(() => {
    return unlistedAssets.map(
      (assetItem): PortfolioAssetGroup => ({
        ...assetItem,
        assets: [assetItem],
        totalValue: assetItem.value ?? 0,
        totalAmount: Number(assetItem.quantity),
      }),
    )
  }, [unlistedAssets])

  if (unlistedAssets.length === 0) {
    return null
  }

  return (
    <Collapsible.Root open={isOpen} onOpenChange={handleOpenChange} className={styles.collapsible}>
      <Collapsible.Trigger ref={triggerRef} className={styles.trigger}>
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
            {assetGroups.map((assetGroup) => (
              <AssetGroup assetGroup={assetGroup} key={assetGroup.assets[0].denom} />
            ))}
          </div>
        </animated.div>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

export default UnlistedAssets
