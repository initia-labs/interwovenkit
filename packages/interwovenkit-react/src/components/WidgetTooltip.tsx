import clsx from "clsx"
import { type PropsWithChildren } from "react"
import { Tooltip } from "radix-ui"
import { usePortal } from "@/public/app/PortalContext"
import styles from "./WidgetTooltip.module.css"
import { useAmplitudeDelayedLog } from "@/lib/amplitude/hooks"
import type { AmplitudeEvent } from "@/lib/amplitude/types"

interface Props extends Tooltip.TooltipProps {
  label: string
  small?: boolean
  amplitudeEvent?: AmplitudeEvent
}

const WidgetTooltip = ({
  label,
  children,
  small,
  amplitudeEvent,
  ...props
}: PropsWithChildren<Props>) => {
  const setOpen = useAmplitudeDelayedLog(amplitudeEvent)

  return (
    <Tooltip.Root {...props} onOpenChange={setOpen}>
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
