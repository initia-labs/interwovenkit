import xss from "xss"
import { useEffect, useState } from "react"
import { IconCheckCircleFilled, IconCloseCircleFilled } from "@initia/icons-react"
import Button from "@/components/Button"
import { sanitizeLink } from "@/components/explorer"
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

// Per-status stall budget: the pipeline spans several statuses (~5 min
// end-to-end), so each gets its own minute before the "taking a little longer"
// reassurance replaces the normal status copy.
const TAKING_LONGER_DELAY = 60 * 1000

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

  const receiveAsset = useReceiveAsset({
    denom: receiveDenom,
    chainId: receiveChainId,
    symbol: receiveSymbol,
  })

  // Without the deposit address, discovery cannot match anything and the screen
  // would show "Waiting" forever, so its failure is a hard error, unlike the
  // transient polling errors below.
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
  } = useTrackedDeposit({ depositAddress })
  const isMismatchError = trackingError instanceof DepositAddressMismatchError
  const isHardError = isAddressError || isMismatchError

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

  const explorerUrl = deposit?.bot_tx_explorer_url
    ? xss(sanitizeLink(deposit.bot_tx_explorer_url))
    : ""

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

  const inFlightMessage = () => {
    if (isDelayed) {
      return (
        <>
          <p className={styles.delayHeading}>This is taking a little longer</p>
          <DepositStatus>
            We hit a temporary delay and are retrying.
            <br />
            Your funds are safe at your deposit address.
          </DepositStatus>
        </>
      )
    }
    // Transient re-discovery frame (entry always follows a detection); render
    // the loader alone until the shared query cache repopulates.
    if (!deposit) return null
    if (bucket === "waiting") {
      return (
        <DepositStatus>
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
        </DepositStatus>
      )
    }
    return <DepositStatus>We&apos;re moving your funds to the destination chain now.</DepositStatus>
  }

  const renderBody = () => {
    if (isHardError) {
      return (
        <>
          <IconCloseCircleFilled size={48} className={styles.failIcon} aria-hidden="true" />
          <p className={styles.heading}>Couldn&apos;t track your deposit</p>
          <DepositStatus error>
            {(addressError ?? trackingError)?.message ??
              "Something went wrong while tracking your deposit."}
          </DepositStatus>
        </>
      )
    }

    switch (bucket) {
      case "completed":
        return (
          <>
            <IconCheckCircleFilled size={48} className={styles.successIcon} aria-hidden="true" />
            {/* The activity indexer can lag delivery by a few seconds, so "Go
                to history" may land on a list still missing this record; the
                caveat keeps that from reading as a failed transfer. */}
            <DepositStatus>
              {completedAmount} was delivered to your wallet on {receiveAsset.chainName}. It may
              take a moment to appear in your activity.
            </DepositStatus>
            <ExplorerLinks
              explorerUrl={explorerUrl}
              onHistoryClick={() => openDrawer("/activity")}
            />
          </>
        )
      case "failed":
        return (
          <>
            <IconCloseCircleFilled size={48} className={styles.failIcon} aria-hidden="true" />
            <p className={styles.heading}>Deposit failed</p>
            {/* No support channel exists in the widget or config, so the copy
                must not point at one. */}
            <DepositStatus error>
              This deposit could not be completed. Your funds remain at the deposit address with no
              automatic refund.
            </DepositStatus>
            <ExplorerLinks explorerUrl={explorerUrl} />
          </>
        )
      case "below_minimum":
        return (
          <>
            <IconCloseCircleFilled size={48} className={styles.failIcon} aria-hidden="true" />
            <p className={styles.heading}>Amount below minimum</p>
            <DepositStatus error>
              {minLabel ? `Deposits below ${minLabel} can't be processed. ` : ""}
              Your funds remain at the deposit address with no automatic refund.
            </DepositStatus>
          </>
        )
      case "waiting":
      case "processing":
        return (
          <>
            <Loader size={40} color="var(--success)" />
            {inFlightMessage()}
            {chips}
          </>
        )
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

  // No back button: entry always follows a discovered deposit, so funds are
  // already in flight (or settled) and there is no pre-arrival state to back
  // out of.
  return (
    <DepositSubpage title={title()}>
      <div className={styles.body}>
        {renderBody()}
        {isTrackingError && !isHardError && !isFinal && (
          <DepositStatus error>Connection lost. Retrying…</DepositStatus>
        )}
      </div>
      {renderFooter()}
    </DepositSubpage>
  )
}

export default DepositTracking
