import type { StdFee } from "@cosmjs/stargate"
import type { TxJson } from "@skip-go/client"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import FormHelp from "@/components/form/FormHelp"
import { useLocationState, useNavigate } from "@/lib/router"
import { type BridgeTxResult, useBridgePreviewState, useBridgeTx } from "./data/tx"
import { useRouteRefresh } from "./data/useRouteRefresh"

interface Props {
  tx: TxJson
  fee?: StdFee
  onCompleted?: (result: BridgeTxResult) => void
  confirmMessage?: string
  error?: string
}

const BridgePreviewFooter = ({ tx, fee, onCompleted, confirmMessage, error }: Props) => {
  const navigate = useNavigate()
  const state = useLocationState<Record<string, unknown>>()
  const { route, values, quoteVerifiedAt, requiresReconfirm } = useBridgePreviewState()
  const { mutate, isPending } = useBridgeTx(tx, { customFee: fee, onCompleted })
  const { refreshRouteIfNeeded, isRefreshing, refreshError, clearRefreshError } = useRouteRefresh(
    route,
    values,
    quoteVerifiedAt,
  )

  const onConfirm = async () => {
    if (isPending || isRefreshing) return

    if (requiresReconfirm) {
      // quoteVerifiedAt is always defined here (set when navigating with requiresReconfirm: true).
      // Date.now() fallback is safer than 0, which would immediately mark the route as stale.
      navigate(0, {
        ...state,
        route,
        values,
        quoteVerifiedAt: quoteVerifiedAt ?? Date.now(),
        requiresReconfirm: false,
      })
      return
    }

    if (await refreshRouteIfNeeded()) return

    clearRefreshError()
    mutate()
  }

  const statusMessage =
    error ??
    refreshError ??
    (requiresReconfirm ? "Route updated. Please review and confirm again." : undefined)

  return (
    <Footer
      extra={
        statusMessage && (
          <FormHelp level={error || refreshError ? "error" : "info"}>{statusMessage}</FormHelp>
        )
      }
    >
      <Button.White
        onClick={onConfirm}
        loading={isRefreshing ? "Refreshing route..." : isPending && "Signing transaction..."}
        disabled={!!error}
      >
        {confirmMessage || (requiresReconfirm ? "Confirm updated route" : "Confirm")}
      </Button.White>
    </Footer>
  )
}

export default BridgePreviewFooter
