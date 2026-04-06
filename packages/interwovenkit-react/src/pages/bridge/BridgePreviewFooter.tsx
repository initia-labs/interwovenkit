import type { StdFee } from "@cosmjs/stargate"
import type { TxJson } from "@skip-go/client"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import FormHelp from "@/components/form/FormHelp"
import { useLocationState, useNavigate } from "@/lib/router"
import { buildReconfirmLocationState } from "./data/locationState"
import { type BridgeTxResult, useBridgePreviewState, useBridgeTx } from "./data/tx"
import { useRouteRefresh } from "./data/useRouteRefresh"
import { getBridgeConfirmLabel } from "./confirmLabel"

interface Props {
  tx: TxJson
  fee?: StdFee
  onCompleted?: (result: BridgeTxResult) => void
  confirmMessage?: string
  error?: string
  warning?: string
  isCheckingApprovals?: boolean
  isCheckingFeeBalance?: boolean
  messageRefreshError?: string
  isRouteTransitioning?: boolean
  isFetchingMessages?: boolean
  isEstimatingGas?: boolean
}

function getStatusMessage({
  error,
  warning,
  messageRefreshError,
  refreshError,
  requiresReconfirm,
}: {
  error?: string
  warning?: string
  messageRefreshError?: string
  refreshError?: string
  requiresReconfirm?: boolean
}): { level: "error" | "warning" | "info"; text: string } | undefined {
  if (error) return { level: "error", text: error }
  if (messageRefreshError) return { level: "error", text: messageRefreshError }
  if (refreshError) return { level: "error", text: refreshError }
  if (warning) return { level: "warning", text: warning }
  if (requiresReconfirm) {
    return { level: "info", text: "Route updated. Please review and confirm again." }
  }
}

function getBackgroundLoadingText({
  isCheckingApprovals,
  isCheckingFeeBalance,
  isFetchingMessages,
  isEstimatingGas,
  isRouteTransitioning,
}: {
  isCheckingApprovals?: boolean
  isCheckingFeeBalance?: boolean
  isFetchingMessages?: boolean
  isEstimatingGas?: boolean
  isRouteTransitioning?: boolean
}): string | false {
  if (isRouteTransitioning) return "Refreshing route..."
  if (isFetchingMessages) return "Fetching messages..."
  if (isCheckingFeeBalance) return "Checking fee balance..."
  if (isCheckingApprovals) return "Checking approvals..."
  if (isEstimatingGas) return "Estimating gas..."
  return false
}

function getLoadingText({
  isRefreshing,
  isPending,
  backgroundLoadingText,
}: {
  isRefreshing: boolean
  isPending: boolean
  backgroundLoadingText: string | false
}): string | false {
  if (isRefreshing) return "Refreshing route..."
  if (isPending) return "Signing transaction..."
  return backgroundLoadingText
}

const BridgePreviewFooter = ({
  tx,
  fee,
  onCompleted,
  confirmMessage,
  error,
  warning,
  isCheckingApprovals,
  isCheckingFeeBalance,
  messageRefreshError,
  isRouteTransitioning,
  isFetchingMessages,
  isEstimatingGas,
}: Props) => {
  const navigate = useNavigate()
  const state = useLocationState<Record<string, unknown>>()
  const { route, values, quoteVerifiedAt, requiresReconfirm } = useBridgePreviewState()
  const { mutate, isPending } = useBridgeTx(tx, { customFee: fee, onCompleted })
  const { refreshRouteIfNeeded, isRefreshing, refreshError, clearRefreshError } = useRouteRefresh(
    route,
    values,
    quoteVerifiedAt,
  )
  const backgroundLoadingText = getBackgroundLoadingText({
    isCheckingApprovals,
    isCheckingFeeBalance,
    isFetchingMessages,
    isEstimatingGas,
    isRouteTransitioning,
  })

  const onConfirm = async () => {
    if (isPending || isRefreshing || backgroundLoadingText || messageRefreshError) return

    if (requiresReconfirm) {
      // quoteVerifiedAt is always defined here (set when navigating with requiresReconfirm: true).
      // Date.now() fallback is safer than 0, which would immediately mark the route as stale.
      navigate(
        0,
        buildReconfirmLocationState({
          currentState: state,
          route,
          values,
          quoteVerifiedAt: quoteVerifiedAt ?? Date.now(),
        }),
      )
      return
    }

    if (await refreshRouteIfNeeded()) return

    clearRefreshError()
    mutate()
  }

  const statusMessage = getStatusMessage({
    error,
    warning,
    messageRefreshError,
    refreshError,
    requiresReconfirm,
  })
  const loadingText = getLoadingText({ isRefreshing, isPending, backgroundLoadingText })
  const isBusy = isPending || isRefreshing || !!backgroundLoadingText || !!messageRefreshError

  return (
    <Footer
      extra={statusMessage && <FormHelp level={statusMessage.level}>{statusMessage.text}</FormHelp>}
    >
      <Button.White
        onClick={onConfirm}
        loading={loadingText}
        disabled={!!error || !!warning || isBusy}
      >
        {getBridgeConfirmLabel(confirmMessage, Boolean(requiresReconfirm))}
      </Button.White>
    </Footer>
  )
}

export default BridgePreviewFooter
