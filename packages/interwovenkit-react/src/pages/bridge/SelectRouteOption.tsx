import clsx from "clsx"
import { IconCheck, IconClockFilled } from "@initia/icons-react"
import { formatAmount } from "@initia/utils"
import Skeleton from "@/components/Skeleton"
import { formatValue } from "@/lib/format"
import { useSkipAsset } from "./data/assets"
import { useBridgeForm } from "./data/form"
import { formatDuration } from "./data/format"
import type { useRouteQuery } from "./data/simulate"
import styles from "./SelectRouteOption.module.css"

import type { PropsWithChildren } from "react"

export type RouteType = "default" | "op"

interface Props {
  label: string
  query: ReturnType<typeof useRouteQuery>
  value: RouteType
  onSelect: (type: RouteType) => void
  checked: boolean
}

const SelectRouteOptionStack = ({ children }: PropsWithChildren) => {
  return <div className={styles.stack}>{children}</div>
}

const SelectRouteOption = ({ label, query, value, onSelect, ...props }: Props) => {
  const { data: route, isLoading } = query
  const { watch } = useBridgeForm()
  const { dstChainId, dstDenom } = watch()
  const dstAsset = useSkipAsset(dstDenom, dstChainId)

  const checked = !isLoading && props.checked
  const disabled = !isLoading && !route

  return (
    <button
      type="button"
      className={clsx(styles.button, {
        [styles.isLoading]: isLoading,
        [styles.disabled]: disabled,
        [styles.checked]: checked,
      })}
      onClick={() => {
        if (isLoading || disabled) return
        onSelect(value)
      }}
    >
      <div className={styles.header}>
        <div className={styles.title}>
          <span>{label}</span>
          {checked && <IconCheck size={14} />}
        </div>

        {isLoading ? (
          <Skeleton width={80} height={16} />
        ) : !route ? (
          <div className={styles.duration}>Not available</div>
        ) : (
          <div className={clsx(styles.duration, { [styles.warning]: value === "op" })}>
            <IconClockFilled size={12} />
            <span>{formatDuration(route.estimated_route_duration_seconds)}</span>
          </div>
        )}
      </div>

      {(isLoading || route) && (
        <>
          <div className={styles.amount}>
            {isLoading ? (
              <Skeleton width={260} height={40} />
            ) : !route ? null : (
              formatAmount(route.amount_out, { decimals: dstAsset.decimals })
            )}
          </div>

          <div className={styles.value}>
            {isLoading ? (
              <Skeleton width={120} height={16} />
            ) : !route ? null : route.usd_amount_out ? (
              formatValue(route.usd_amount_out)
            ) : (
              "$-"
            )}
          </div>
        </>
      )}
    </button>
  )
}

SelectRouteOption.Stack = SelectRouteOptionStack

export default SelectRouteOption
