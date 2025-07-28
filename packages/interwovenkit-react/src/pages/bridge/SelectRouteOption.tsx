import clsx from "clsx"
import type { PropsWithChildren } from "react"
import { IconClockFilled } from "@initia/icons-react"
import { formatAmount } from "@initia/utils"
import Loader from "@/components/Loader"
import { formatDuration } from "./data/format"
import { useBridgeForm } from "./data/form"
import { useSkipAsset } from "./data/assets"
import type { useRouteQuery } from "./data/simulate"
import styles from "./SelectRouteOption.module.css"

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

const SelectRouteOption = ({ label, query, value, onSelect, checked }: Props) => {
  const { data, isLoading } = query
  const { watch } = useBridgeForm()
  const { dstChainId, dstDenom } = watch()
  const dstAsset = useSkipAsset(dstDenom, dstChainId)

  return (
    <button
      type="button"
      className={clsx(styles.button, { [styles.checked]: checked })}
      onClick={() => onSelect(value)}
    >
      <div className={styles.checkmark}>{checked && <span className={styles.inner} />}</div>

      <div className={styles.info}>
        <div>{label}</div>
        <div className={styles.duration}>
          <IconClockFilled size={12} />
          {data ? formatDuration(data.estimated_route_duration_seconds) : "Not available"}
        </div>
      </div>

      <div className={styles.amount}>
        {isLoading ? (
          <Loader size={14} />
        ) : (
          <>
            <span>{formatAmount(data?.amount_out, { decimals: dstAsset.decimals })}</span>
            <span className={styles.symbol}>{dstAsset.symbol}</span>
          </>
        )}
      </div>
    </button>
  )
}

SelectRouteOption.Stack = SelectRouteOptionStack

export default SelectRouteOption
