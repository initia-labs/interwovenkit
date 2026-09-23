import { useEffect, useState } from "react"
import { IconCheckCircleFilled, IconCloseCircleFilled } from "@initia/icons-react"
import Button from "@/components/Button"
import { safeExplorerUrl } from "@/components/explorer"
import Footer from "@/components/Footer"
import Image from "@/components/Image"
import Loader from "@/components/Loader"
import { useDrawer, useModal } from "@/data/ui"
import { useSkipChains } from "@/pages/bridge/data/chains"
import { useInitiaAddress } from "@/public/data/hooks"
import { useReceiveAsset, useSourceRoute } from "./data/assets"
import { useDepositAddress } from "./data/depositAddress"
import {
  DepositAddressMismatchError,
  displayBucket,
  isTerminalBucket,
  useTrackedDeposit,
} from "./data/deposits"
import { fallbackChainName, findDestinationNetwork, formatSourceMin } from "./data/source"
import { useSourceAssetLookup } from "./data/sourceAssets"
import { formatCompletedAmount } from "./completedAmount"
import { useDepositForm, useDepositNavigate } from "./context"
import DepositStatus from "./DepositStatus"
import DepositSubpage from "./DepositSubpage"
import ExplorerLinks from "./ExplorerLinks"
import FlowChips from "./FlowChips"
import styles from "./DepositTracking.module.css"

import type { ReactNode } from "react"

// Per-stage stall budget, shared with the wallet flow's DepositProgress: the pipeline
// spans several statuses (~5 min end-to-end), so each gets its own minute before the
// "taking a little longer" reassurance replaces the normal status copy.
export const TAKING_LONGER_DELAY = 60 * 1000

// Selects the icon and the status color; the copy is entirely the controller's.
export type DepositTrackingVariant =
  | "in-flight"
  | "completed"
  | "failed"
  | "below-minimum"
  | "problem"

interface DepositTrackingViewProps {
  title: string
  variant: DepositTrackingVariant
  /** On an in-flight screen this is the stall reassurance; elsewhere the outcome heading. */
  heading?: string
  /** Omitted renders no status block, for transient frames that have nothing to say yet. */
  message?: ReactNode
  chips?: ReactNode
  explorerUrl?: string
  onHistoryClick?: () => void
  footer?: ReactNode
  isRetrying?: boolean
  /** Extra body content between the chips and the links. */
  extra?: ReactNode
}

// Shared body for both tracking controllers: the address/onramp tracker below and
// the wallet flow's DepositProgress, which reports on stages that exist before any
// Deposit record has been discovered.
export const DepositTrackingView = ({
  title,
  variant,
  heading,
  message,
  chips,
  explorerUrl,
  onHistoryClick,
  footer,
  isRetrying,
  extra,
}: DepositTrackingViewProps) => {
  // Completion is the only green outcome; every other terminal screen shares the
  // error treatment.
  const isError = variant !== "in-flight" && variant !== "completed"

  return (
    <DepositSubpage title={title}>
      <div className={styles.body}>
        {variant === "in-flight" ? (
          <Loader size={40} color="var(--success)" />
        ) : variant === "completed" ? (
          <IconCheckCircleFilled size={48} className={styles.successIcon} aria-hidden="true" />
        ) : (
          <IconCloseCircleFilled size={48} className={styles.failIcon} aria-hidden="true" />
        )}

        {heading && (
          <p className={variant === "in-flight" ? styles.delayHeading : styles.heading}>
            {heading}
          </p>
        )}

        {message && (
          <DepositStatus error={isError} className={styles.message}>
            {message}
          </DepositStatus>
        )}

        {chips}
        {extra}

        <ExplorerLinks explorerUrl={explorerUrl} onHistoryClick={onHistoryClick} />

        {isRetrying && <DepositStatus className={styles.note}>Reconnecting…</DepositStatus>}
      </div>

      {footer}
    </DepositSubpage>
  )
}

/**
 * Deposit tracking screen shared by the address transfer and onramp purchase
 * paths (both deliver to the same deposit address). Entry always follows a
 * discovered deposit, so there is no pre-arrival waiting screen; a null deposit
 * is a transient re-discovery frame, not a state. Polls the lifecycle and
 * renders a screen per status bucket; a stalled non-terminal status shows a
 * "taking a little longer" reassurance.
 */
const DepositTracking = () => {
  const navigate = useDepositNavigate()
  const { closeModal } = useModal()
  const { openDrawer } = useDrawer()
  const { watch } = useDepositForm()
  const walletAddress = useInitiaAddress()

  const receiveSymbol = watch("receiveSymbol")
  const receiveDenom = watch("receiveDenom")
  const receiveChainId = watch("receiveChainId")
  const method = watch("method")
  const trackedDepositId = watch("trackedDepositId")

  const receiveAsset = useReceiveAsset({
    denom: receiveDenom,
    chainId: receiveChainId,
    symbol: receiveSymbol,
  })

  // The deposit address is only the trust-boundary input for the mismatch
  // check below (skipped while empty — see resolveTrackedDeposit); the record
  // itself is polled by id. So an address failure alone must not replace a
  // live status view (see isHardError).
  const {
    data: addressData,
    isError: isAddressError,
    error: addressError,
  } = useDepositAddress({
    walletAddress,
    chainId: receiveChainId,
    assetDenom: receiveDenom,
  })
  const depositAddress = addressData?.deposit_address ?? ""

  // Tracking poll errors are transient: the interval keeps refetching, so they
  // surface as a non-terminal retry notice. The exception is the typed
  // address-mismatch violation, which every poll reproduces — a "retrying"
  // notice would misattribute it to the network forever, so it takes the
  // hard-error screen like the address error.
  const {
    deposit,
    isError: isTrackingError,
    error: trackingError,
  } = useTrackedDeposit({ depositAddress, depositId: trackedDepositId })
  const isMismatchError = trackingError instanceof DepositAddressMismatchError
  // Hard only when nothing can render: the mismatch violation (every poll
  // reproduces it), or an address failure with no record — without either the
  // screen would sit on the bare loader forever. With a record in hand an
  // address failure is ignored; the mismatch check applies once the address
  // arrives.
  const isHardError = isMismatchError || (isAddressError && !deposit)

  // displayBucket is the one render point where the wire can betray the type
  // claim: an unknown bucket normalizes to the failed screen (fail-closed).
  const bucket = displayBucket(deposit)
  const isFinal = isTerminalBucket(bucket)

  // "Taking a little longer": armed per status so each pipeline step gets its
  // own delay budget. The flag stores which status stalled, so a transition
  // invalidates it by comparison (no state reset inside the effect).
  const [delayedStatus, setDelayedStatus] = useState<string | null>(null)
  const status = deposit?.status
  const isDelayed = !!status && delayedStatus === status
  useEffect(() => {
    if (!status) return
    const timer = setTimeout(() => setDelayedStatus(status), TAKING_LONGER_DELAY)
    return () => clearTimeout(timer)
  }, [status])

  // Source-side display: what the user sent, resolved from the discovered
  // deposit's Router-matching identifiers.
  const lookup = useSourceAssetLookup()
  const skipChains = useSkipChains()
  const sentSymbol = deposit ? lookup.symbol(deposit.src_chain_id, deposit.src_denom) : ""
  const sentLogoUrl = deposit ? lookup.logoUrl(deposit.src_chain_id, deposit.src_denom) : ""
  const srcChain = deposit
    ? skipChains.find((chain) => chain.chain_id === deposit.src_chain_id)
    : undefined
  const srcChainName = deposit
    ? (srcChain?.pretty_name ?? fallbackChainName(deposit.src_chain_id))
    : ""

  const explorerUrl = safeExplorerUrl(deposit?.bot_tx_explorer_url)

  // `src_decimals` comes from the deposit's route in the Deposit API's
  // `config/assets`; when the route has since been removed, the minimum cannot
  // be formatted and the below_minimum copy falls back to its generic sentence.
  const sourceRoute = useSourceRoute(deposit?.src_chain_id ?? "", deposit?.src_denom ?? "")
  const minLabel =
    deposit?.required_min_amount && sourceRoute
      ? // formatSourceMin rounds UP at its decimal cap: understating a required
        // minimum would let the user re-send exactly the displayed amount and
        // land below_minimum again (funds stranded, no refund).
        formatSourceMin(deposit.required_min_amount, sourceRoute.src_decimals, sentSymbol)
      : ""

  // Amount phrase for the completed copy; the preference order and its
  // rationale live on formatCompletedAmount.
  const dstNetwork =
    deposit && sourceRoute
      ? findDestinationNetwork(sourceRoute, deposit.dst_chain_id, deposit.dst_denom)
      : undefined
  const completedAmount = formatCompletedAmount({
    amountOut: deposit?.amount_out,
    sentAmount: deposit?.amount,
    dstDecimals: dstNetwork?.decimals,
    srcDecimals: sourceRoute?.src_decimals,
    receiveSymbol,
    sentSymbol,
  })

  const title = () => {
    if (isHardError) return "Deposit status"
    switch (bucket) {
      case "waiting":
        return "Confirming your deposit…"
      case "processing":
        return "Transferring…"
      case "completed":
        // The onramp path completes a purchase transaction; the address path
        // completes a transfer.
        return method === "onramp" ? "Transaction complete" : "Transfer complete"
      // Failure states keep a neutral page title; the body renders the
      // specific heading ("Deposit failed" / "Amount below minimum") and the
      // recovery copy.
      case "failed":
      case "below_minimum":
        return "Deposit status"
    }
  }

  const chips = deposit && (
    <FlowChips
      steps={[
        {
          label: "You sent",
          logoUrl: sentLogoUrl,
          chainLogoUrl: srcChain?.logo_uri ?? "",
          text: sentSymbol,
        },
        {
          label: "You receive",
          logoUrl: receiveAsset.logoUrl,
          chainLogoUrl: receiveAsset.chainLogoUrl,
          text: receiveSymbol,
        },
      ]}
    />
  )

  const variant = (): DepositTrackingVariant => {
    if (isHardError) return "problem"
    switch (bucket) {
      case "completed":
        return "completed"
      case "failed":
        return "failed"
      case "below_minimum":
        return "below-minimum"
      case "waiting":
      case "processing":
        return "in-flight"
    }
  }

  const heading = () => {
    if (isHardError) return "Couldn't track your deposit"
    switch (bucket) {
      case "failed":
        return "Deposit failed"
      case "below_minimum":
        return "Amount below minimum"
      case "waiting":
      case "processing":
        // The only in-flight heading is the stall reassurance.
        return isDelayed ? "This is taking a little longer" : undefined
      case "completed":
        return undefined
    }
  }

  const inFlightMessage = () => {
    if (isDelayed) {
      return (
        <>
          We hit a temporary delay and are retrying.
          <br />
          Your funds are safe at your deposit address.
        </>
      )
    }
    // Transient re-discovery frame (entry always follows a detection); render
    // the loader alone until the shared query cache repopulates.
    if (!deposit) return undefined
    if (bucket === "waiting") {
      return (
        <span className={styles.confirming}>
          Your deposit is confirming on
          <Image
            src={srcChain?.logo_uri ?? ""}
            width={16}
            height={16}
            className={styles.chainLogo}
            classNames={{ placeholder: styles.chainLogo }}
          />
          {srcChainName}
        </span>
      )
    }
    return <>We&apos;re moving your funds to the destination chain now.</>
  }

  const message = () => {
    if (isHardError) {
      return (
        (addressError ?? trackingError)?.message ??
        "Something went wrong while tracking your deposit."
      )
    }
    switch (bucket) {
      case "completed":
        return `${completedAmount} was delivered to your wallet on ${receiveAsset.chainName}.`
      case "failed":
        // No support channel exists in the widget or config, so the copy must not point at one.
        return "This deposit could not be completed. Your funds remain at the deposit address with no automatic refund."
      case "below_minimum":
        return `${minLabel ? `Deposits below ${minLabel} can't be processed. ` : ""}Your funds remain at the deposit address with no automatic refund.`
      case "waiting":
      case "processing":
        return inFlightMessage()
    }
  }

  const renderFooter = () => {
    if (isHardError || bucket === "failed" || bucket === "below_minimum") {
      return (
        <Footer>
          <Button.Outline fullWidth onClick={closeModal}>
            Close
          </Button.Outline>
        </Footer>
      )
    }
    if (bucket === "completed") {
      // Onramp purchases end here; address transfers offer a repeat, returning
      // to the same deterministic deposit address.
      return (
        <Footer>
          {method === "onramp" ? (
            <Button.White fullWidth onClick={closeModal}>
              Close
            </Button.White>
          ) : (
            <Button.Outline fullWidth onClick={() => navigate("address")}>
              Make another transfer
            </Button.Outline>
          )}
        </Footer>
      )
    }
    return null
  }

  // A hard error replaces the whole body: the bucket it was derived from is not
  // trustworthy, so neither the chips nor the explorer links may ride along.
  const isInFlight = !isHardError && (bucket === "waiting" || bucket === "processing")
  const isCompleted = !isHardError && bucket === "completed"
  const hasExplorerLink = isCompleted || (!isHardError && bucket === "failed")

  // No back button: entry always follows a discovered deposit, so funds are
  // already in flight (or settled) and there is no pre-arrival state to back
  // out of.
  return (
    <DepositTrackingView
      title={title()}
      variant={variant()}
      heading={heading()}
      message={message()}
      chips={isInFlight ? chips : undefined}
      explorerUrl={hasExplorerLink ? explorerUrl : undefined}
      onHistoryClick={isCompleted ? () => openDrawer("/activity") : undefined}
      footer={renderFooter()}
      isRetrying={isTrackingError && !isHardError && !isFinal}
    />
  )
}

export default DepositTracking
