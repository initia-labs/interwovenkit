import clsx from "clsx"
import { useState, useEffect, type PropsWithChildren } from "react"
import { Tooltip } from "radix-ui"
import { useMediaQuery } from "usehooks-ts"
import { usePortal } from "@/public/app/PortalContext"
import styles from "./WidgetTooltip.module.css"

interface Props extends Tooltip.TooltipProps {
  label: string
  small?: boolean
}

const WidgetTooltip = ({ label, children, small, ...props }: PropsWithChildren<Props>) => {
  const [open, setOpen] = useState(false)
  const isMobile = useMediaQuery("(max-width: 576px)")
  const portal = usePortal()

  // Auto-close tooltip on mobile after 3 seconds
  useEffect(() => {
    if (isMobile && open) {
      const timer = setTimeout(() => setOpen(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [isMobile, open])

  const handleOpenChange = (newOpen: boolean) => {
    // On mobile, only allow opening via click (not hover)
    if (isMobile) {
      // Don't open on hover events
      if (newOpen && !open) {
        return
      }
    }
    setOpen(newOpen)
  }

  const handleClick = () => {
    if (isMobile) {
      setOpen(!open)
    }
  }

  return (
    <Tooltip.Root open={open} onOpenChange={handleOpenChange} {...props}>
      <Tooltip.Trigger asChild onClick={handleClick}>
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal container={portal}>
        <Tooltip.Content
          className={clsx(styles.tooltip, { small })}
          collisionBoundary={portal}
          collisionPadding={8}
          sideOffset={4}
        >
          {label}
          <Tooltip.Arrow className={styles.arrow} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export default WidgetTooltip
