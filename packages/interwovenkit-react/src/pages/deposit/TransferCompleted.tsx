import Button from "@/components/Button"
import { useConfig } from "@/data/config"
import { useModal } from "@/data/ui"
import { useLocationState } from "@/lib/router"
import { useSkipAsset } from "../bridge/data/assets"
import { formatDuration } from "../bridge/data/format"
import { useBridgePreviewState, useTrackTxQuery, useTxStatusQuery } from "../bridge/data/tx"
import CompletedDarkAnimation from "./assets/CompletedDark.mp4"
import CompletedLightAnimation from "./assets/CompletedLight.mp4"
import FailedDarkIcon from "./assets/FailedDark.svg"
import FailedLightIcon from "./assets/FailedLight.svg"
import LoadingDarkAnimation from "./assets/LoadingDark.mp4"
import LoadingLightAnimation from "./assets/LoadingLight.mp4"
import styles from "./TransferCompleted.module.css"

interface SuccessState {
  txHash: string
  chainId: string
  timestamp: number
}

interface ErrorState {
  error: true
  message: string
  timestamp?: number
}

type TxState = "pending" | "success" | "failed"

function getTxState(txStatus?: { state: string } | null): TxState {
  if (!txStatus) return "pending"

  const status = txStatus.state
  if (status === "STATE_COMPLETED_SUCCESS") {
    return "success"
  } else if (
    status === "STATE_ABANDONED" ||
    status === "STATE_COMPLETED_ERROR" ||
    status === "STATE_PENDING_ERROR"
  ) {
    return "failed"
  }
  return "pending"
}

export function TransferCompleted({ type }: { type: "deposit" | "withdraw" }) {
  const state = useLocationState<SuccessState | ErrorState>()
  const { route, values } = useBridgePreviewState()
  const { closeModal } = useModal()
  const { theme } = useConfig()

  const isError = "error" in state
  const txHash = !isError ? state.txHash : ""
  const chainId = !isError ? state.chainId : ""
  const timestamp = ("timestamp" in state ? state.timestamp : undefined) ?? 0

  // Get source asset information for display
  const { srcDenom, srcChainId, quantity } = values
  const srcAsset = useSkipAsset(srcDenom, srcChainId)

  const actionLabel = type === "deposit" ? "Deposit" : "Withdraw"

  // Track the transaction (always call hooks)
  const { data: trackedTxHash } = useTrackTxQuery({
    chainId,
    txHash,
    tracked: false,
    timestamp,
    route,
    values,
  })

  // Query transaction status
  const { data: txStatus } = useTxStatusQuery({
    chainId,
    txHash,
    tracked: !!trackedTxHash,
    timestamp,
    route,
    values,
  })

  // Derive state from transaction status
  const txState = getTxState(txStatus)

  // icons
  const failedIcon = theme === "dark" ? FailedDarkIcon : FailedLightIcon
  const loadingAnimation = theme === "dark" ? LoadingDarkAnimation : LoadingLightAnimation
  const completedAnimation = theme === "dark" ? CompletedDarkAnimation : CompletedLightAnimation

  // Error state handling
  if (isError) {
    return (
      <div className={styles.container}>
        <h3 className={styles.title}>{actionLabel} failed</h3>
        <img src={failedIcon} alt="Failed" className={styles.errorIcon} />
        <p className={styles.error}>{state.message}</p>
        <Button.White fullWidth onClick={closeModal}>
          Close
        </Button.White>
      </div>
    )
  }

  const estimatedDuration = formatDuration(route.estimated_route_duration_seconds)

  // Generate Skip Explorer URL
  const searchParams = new URLSearchParams({ tx_hash: txHash, chain_id: chainId })
  const skipExplorerUrl = new URL(`?${searchParams.toString()}`, "https://explorer.skip.build")

  return (
    <div className={styles.container}>
      {txState === "pending" && (
        <>
          <h3 className={styles.title}>
            {type === "deposit" ? "Depositing" : "Withdrawing"} {quantity} {srcAsset.symbol}
          </h3>
          <video
            src={loadingAnimation}
            autoPlay
            muted
            loop
            playsInline
            style={{ width: "72px", height: "72px", marginBottom: "12px" }}
          />
          <p className={styles.subtitle}>
            Estimated time: <span>{estimatedDuration}</span>
          </p>
          <a
            href={skipExplorerUrl.toString()}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.link}
          >
            View transaction
          </a>
          <p className={styles.subtitle}>Your transaction will continue even if you close this</p>
        </>
      )}
      {txState === "success" && (
        <>
          <h3 className={styles.title}>{actionLabel} complete</h3>
          <video
            src={completedAnimation}
            autoPlay
            muted
            playsInline
            style={{ width: "72px", height: "72px" }}
            onEnded={(e) => {
              const video = e.currentTarget
              video.currentTime = video.duration
              video.pause()
            }}
          />
          <a
            href={skipExplorerUrl.toString()}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.link}
          >
            View transaction
          </a>
          <Button.White fullWidth onClick={closeModal}>
            Close
          </Button.White>
        </>
      )}
      {txState === "failed" && (
        <>
          <h3 className={styles.title}>{actionLabel} failed</h3>
          <img src={failedIcon} alt="Failed" className={styles.errorIcon} />
          <p className={styles.error}>Your transaction could not be completed</p>
          <Button.White fullWidth onClick={closeModal}>
            Close
          </Button.White>
        </>
      )}
    </div>
  )
}
