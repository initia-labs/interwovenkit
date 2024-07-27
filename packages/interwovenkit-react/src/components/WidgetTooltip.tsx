import clsx from "clsx"
import type { PropsWithChildren } from "react"
import { Tooltip } from "radix-ui"
import { usePortal } from "@/public/app/PortalContext"
import styles from "./WidgetTooltip.module.css"

interface Props extends Tooltip.TooltipProps {
  label: string
  small?: boolean
}

const WidgetTooltip = ({ label, children, small, ...props }: PropsWithChildren<Props>) => {
  return (
    <Tooltip.Root {...props}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal container={usePortal()}>
        <Tooltip.Content
          className={clsx(styles.tooltip, { small })}
          collisionBoundary={usePortal()}
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
