import Button from "@/components/Button"
import { useConfig } from "@/data/config"
import { useDrawer, useModal } from "@/data/ui"
import { useSkipAsset } from "@/pages/bridge/data/assets"
import { formatDuration } from "@/pages/bridge/data/format"
import { useTrackTxQuery, useTxStatusQuery } from "@/pages/bridge/data/tx"
import DepositSubpage from "../DepositSubpage"
import ExplorerLinks from "../ExplorerLinks"
import FailedDarkIcon from "./assets/FailedDark.svg"
import FailedLightIcon from "./assets/FailedLight.svg"
import { useTransferFlow, useTransferForm } from "./transferFlowConfig"
import styles from "./TransferCompleted.module.css"

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

export function TransferCompleted() {
  const { mode } = useTransferFlow()
  const { closeModal } = useModal()
  const { theme } = useConfig()
  const { watch } = useTransferForm()
  const { result } = watch()
  const { openDrawer } = useDrawer()

  if (!result) {
    throw new Error("Transfer is completed but result is missing")
  }

  const isError = !result.success
  const txHash = !isError ? result.txhash : ""
  const chainId = !isError ? result.chainId : ""
  const timestamp = !isError ? (result.timestamp ?? 0) : 0

  const { route, values } = result
  const { srcDenom, srcChainId, quantity } = values
  const srcAsset = useSkipAsset(srcDenom, srcChainId)

  const actionLabel = mode === "deposit" ? "Deposit" : "Withdraw"

  const { data: trackedTxHash } = useTrackTxQuery({
    chainId,
    txHash,
    tracked: false,
    timestamp,
    route,
    values,
  })

  const { data: txStatus } = useTxStatusQuery({
    chainId,
    txHash,
    tracked: !!trackedTxHash,
    timestamp,
    route,
    values,
  })

  const txState = getTxState(txStatus)

  const failedIcon = theme === "dark" ? FailedDarkIcon : FailedLightIcon
  const loadingAnimation = `https://assets.initia.xyz/videos/Loading${theme === "dark" ? "Dark" : "Light"}.mp4`
  const completedAnimation = `https://assets.initia.xyz/videos/Completed${theme === "dark" ? "Dark" : "Light"}.mp4`

  if (isError) {
    return (
      <DepositSubpage title={`${actionLabel} failed`}>
        <div className={styles.container}>
          <img src={failedIcon} alt="Failed" className={styles.errorIcon} />
          <p className={styles.error}>{result?.error}</p>
          <Button.White fullWidth onClick={closeModal}>
            Close
          </Button.White>
        </div>
      </DepositSubpage>
    )
  }

  const estimatedDuration = formatDuration(route.estimated_route_duration_seconds)

  const searchParams = new URLSearchParams({ tx_hash: txHash, chain_id: chainId })
  const skipExplorerUrl = new URL(`?${searchParams.toString()}`, "https://explorer.skip.build")

  const renderExplorerLinks = () => (
    <ExplorerLinks
      explorerUrl={skipExplorerUrl.toString()}
      onHistoryClick={() => {
        closeModal()
        openDrawer("/bridge/history")
      }}
    />
  )

  const title = () => {
    switch (txState) {
      case "pending":
        return `${mode === "deposit" ? "Depositing" : "Withdrawing"} ${quantity} ${srcAsset.symbol}`
      case "success":
        return `${actionLabel} complete`
      case "failed":
        return `${actionLabel} failed`
    }
  }

  return (
    <DepositSubpage title={title()}>
      <div className={styles.container}>
        {txState === "pending" && (
          <>
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
            {renderExplorerLinks()}
            <p className={styles.subtitle}>Your transaction will continue even if you close this</p>
          </>
        )}
        {txState === "success" && (
          <>
            <video
              src={completedAnimation}
              autoPlay
              muted
              playsInline
              style={{ width: "72px", height: "72px" }}
              onTimeUpdate={(e) => {
                const video = e.currentTarget
                if (video.duration - video.currentTime < 0.1) {
                  video.pause()
                }
              }}
            />
            {renderExplorerLinks()}
            <Button.White fullWidth onClick={closeModal}>
              Close
            </Button.White>
          </>
        )}
        {txState === "failed" && (
          <>
            <img src={failedIcon} alt="Failed" className={styles.errorIcon} />
            <p className={styles.error}>Your transaction could not be completed</p>
            <Button.White fullWidth onClick={closeModal}>
              Close
            </Button.White>
          </>
        )}
      </div>
    </DepositSubpage>
  )
}
