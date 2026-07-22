import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { IconCheck, IconCopy } from "@initia/icons-react"
import { truncate } from "@initia/utils"
import AsyncBoundary from "@/components/AsyncBoundary"
import Button from "@/components/Button"
import CopyButton from "@/components/CopyButton"
import Footer from "@/components/Footer"
import Image from "@/components/Image"
import { useSkipChains } from "@/pages/bridge/data/chains"
import { useInitiaAddress } from "@/public/data/hooks"
import { depositQueryKeys } from "../data/api"
import { useProcessingTime, useReceiveAsset } from "../data/assets"
import { useFreshDepositAddress } from "../data/depositAddress"
import { useNewDeposits } from "../data/deposits"
import { fallbackChainName } from "../data/source"
import { useSourceAssetLookup } from "../data/sourceAssets"
import { useDepositForm, useDepositNavigate } from "../context"
import DepositStatus from "../DepositStatus"
import DepositSubpage from "../DepositSubpage"
import FlowChips from "../FlowChips"
import ProcessingTimeValue from "../ProcessingTimeValue"
import {
  useFiatDisplayCode,
  useOnrampCheckout,
  useOnramperSourceRoute,
  useOnrampsMetadata,
} from "./data/onramper"
import { getOnrampDisplayName } from "./data/onramperLogic"
import FiatFlag from "./FiatFlag"
import ProviderLogo from "./ProviderLogo"
import { useOnrampQuote } from "./quote"
import styles from "./OnrampProcessing.module.css"

// Hand off to the provider's hosted payment/KYC page in a new tab so the widget
// stays mounted and can advance to the tracking screen; returns whether the tab
// opened. Running after async work, the open isn't always a user gesture and may
// be popup-blocked — the fallback is a rendered continue link, never a
// current-tab navigation (which unmounts the widget with its form state and its
// route back to this purchase's tracking).
function openCheckoutTab(url: string): boolean {
  const tab = window.open(url, "_blank")
  // Sever the reverse handle: with `opener` intact the third-party page could
  // script this tab (reverse tabnabbing). Assigning after open preserves the
  // popup-blocked detection that a "noopener" feature string would break (null).
  if (tab) tab.opener = null
  return !!tab
}

// crypto.randomUUID is secure-context-only, but host dApps can run on plain-HTTP
// origins (LAN/staging), so fall back to a getRandomValues v4 UUID —
// getRandomValues has no secure-context restriction.
function generateIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// Failure deadline for the checkout inputs: normally present on entry (the Buy
// form blocks submit until the quote resolves), a few seconds covers a re-render
// race. Past it the screen would otherwise show "Processing…" forever with no error.
const READY_TIMEOUT = 5000

/**
 * Processing screen: provider hand-off prompt + flow chips. On entry it runs the
 * cash checkout once (`POST /v1/onramper/checkout` signs the deposit address and
 * creates the Onramper checkout server-side), opens the returned payment/KYC url
 * in a new tab (manual continue link on popup block), then stays up polling for
 * the purchased funds at the deposit address — advancing to the tracking screen
 * once a deposit is detected, the same detection DepositAddress uses. Provider
 * and assets come from the live quote.
 */
const OnrampProcessingBody = () => {
  const { watch } = useDepositForm()
  const navigate = useDepositNavigate()
  const quote = useOnrampQuote()
  const onramps = useOnrampsMetadata()
  const walletAddress = useInitiaAddress()

  const fiatId = watch("fiatId")
  const fiatAmount = watch("fiatAmount")
  const paymentMethodId = watch("paymentMethodId")
  const receiveSymbol = watch("receiveSymbol")
  const receiveDenom = watch("receiveDenom")
  const receiveChainId = watch("receiveChainId")

  const receiveAsset = useReceiveAsset({
    denom: receiveDenom,
    chainId: receiveChainId,
    symbol: receiveSymbol,
  })

  // The Onramper source crypto bought for this destination (e.g. USDC on
  // Ethereum); its id and network feed the checkout body, its route identifiers
  // the Buy chip's symbol and logo (Onramper's `symbol` is unfit for display).
  const sourceRoute = useOnramperSourceRoute(receiveChainId, receiveDenom)
  const sourceCrypto = sourceRoute?.crypto ?? null
  const lookup = useSourceAssetLookup()
  const buySymbol = sourceRoute
    ? lookup.symbol(sourceRoute.route.src_chain_id, sourceRoute.route.src_denom)
    : ""
  const buyLogoUrl = sourceRoute
    ? lookup.logoUrl(sourceRoute.route.src_chain_id, sourceRoute.route.src_denom)
    : ""
  const skipChains = useSkipChains()
  const buyChain = sourceRoute
    ? skipChains.find((chain) => chain.chain_id === sourceRoute.route.src_chain_id)
    : undefined
  const buyChainLogoUrl = buyChain?.logo_uri ?? ""
  const buyChainName = sourceRoute
    ? (buyChain?.pretty_name ?? fallbackChainName(sourceRoute.route.src_chain_id))
    : ""
  const ramp = quote.status === "quoted" ? quote.selected.ramp : ""
  const sourceCryptoId = sourceCrypto?.id ?? ""
  const sourceCryptoNetwork = sourceCrypto?.network ?? ""

  const processingTime = useProcessingTime(sourceRoute?.route, receiveChainId, receiveDenom)

  const { mutateAsync } = useOnrampCheckout()
  // Idempotency key: one per checkout attempt, stable across this screen's
  // renders and the mutation's retries (a fresh attempt remounts with a new key).
  const [uuid] = useState(generateIdempotencyKey)
  // Hold the checkout failure in component state, not the mutation observer's
  // `error`: this screen renders inside a react-spring transition whose rapid
  // re-renders can swallow the observer's error notification (stuck on
  // "Processing…"). A setState from the awaited mutation always re-renders.
  const [checkoutError, setCheckoutError] = useState<Error | null>(null)
  // The created checkout's payment url, plus whether the automatic new-tab open
  // was blocked (see openCheckoutTab) — while blocked, a manual continue link
  // renders.
  const [handoff, setHandoff] = useState<{ url: string; blocked: boolean; ramp: string } | null>(
    null,
  )
  // Once the checkout exists, name the provider it was created with
  // (`handoff.ramp`), not the live quote's: the quote refetches every 30s and can
  // rank a different provider best, but the heading must match `handoff.url`.
  const displayRamp = handoff?.ramp ?? ramp

  // Start the one-shot checkout once its inputs are ready (wallet, provider,
  // source crypto, positive amount). The ref collapses React's double-invoke
  // (and any quote refetch) to a single run.
  const ready =
    !!walletAddress && !!ramp && !!sourceCryptoId && !!sourceCryptoNetwork && Number(fiatAmount) > 0
  const startedRef = useRef(false)
  useEffect(() => {
    if (startedRef.current || !ready) return
    startedRef.current = true
    const startCheckout = async () => {
      try {
        const info = await mutateAsync({
          walletAddress,
          chainId: receiveChainId,
          assetDenom: receiveDenom,
          onramp: ramp,
          fiat: fiatId,
          crypto: sourceCryptoId,
          network: sourceCryptoNetwork,
          amount: Number(fiatAmount),
          paymentMethod: paymentMethodId,
          uuid,
        })
        setHandoff({ url: info.url, blocked: !openCheckoutTab(info.url), ramp })
      } catch (caught) {
        setCheckoutError(caught instanceof Error ? caught : new Error(String(caught)))
      }
    }
    void startCheckout()
  }, [
    ready,
    mutateAsync,
    walletAddress,
    receiveChainId,
    receiveDenom,
    ramp,
    fiatId,
    sourceCryptoId,
    sourceCryptoNetwork,
    fiatAmount,
    paymentMethodId,
    uuid,
  ])

  // Converge into the shared tracking screen only once the purchase is
  // delivered: Onramper sends the bought crypto to the deposit address, so the
  // arrival surfaces through the same cursor-watermark detection poll as a crypto
  // transfer. The cursor keeps old deposits at this reused address (finished, or
  // still bridging from an earlier session) from advancing as if this purchase
  // arrived before it was paid.
  // The fresh-address variant refetches once per mount to reissue the cursor and
  // never in the background, so a failed fetch doesn't heal on its own — an empty
  // address makes detection silently never start, so the failure must surface
  // here (see the address-error status below) with Retry the only recovery.
  const { query: addressQuery, freshCursor } = useFreshDepositAddress({
    walletAddress,
    chainId: receiveChainId,
    assetDenom: receiveDenom,
  })
  const { data: addressData, isError: isAddressError, refetch: refetchAddress } = addressQuery
  const depositAddress = addressData?.deposit_address ?? ""
  const detection = useNewDeposits({ depositAddress, after: freshCursor })
  const shouldAdvance = !!detection.data?.length
  useEffect(() => {
    if (shouldAdvance) navigate("track")
  }, [shouldAdvance, navigate])
  const isDetectionError = detection.isError

  // Fail explicitly when the inputs never become ready (see READY_TIMEOUT).
  useEffect(() => {
    if (ready) return
    const timer = setTimeout(() => {
      if (!startedRef.current) {
        setCheckoutError(new Error("Couldn't start the checkout. Please go back and try again."))
      }
    }, READY_TIMEOUT)
    return () => clearTimeout(timer)
  }, [ready])

  const fiatDisplayCode = useFiatDisplayCode(fiatId)

  // Surface a checkout failure to the local AsyncBoundary (see OnrampProcessing
  // below) instead of silently advancing.
  if (checkoutError) throw checkoutError

  return (
    <DepositSubpage title="Processing…">
      <div className={styles.body}>
        {displayRamp ? <ProviderLogo ramp={displayRamp} size={48} /> : null}

        <p className={styles.heading}>
          Please proceed with{" "}
          {displayRamp ? getOnrampDisplayName(onramps, displayRamp) : "your provider"}
        </p>

        {/* Popup-blocked fallback: hand-off completes from this link's own user
            gesture; stays rendered afterwards to reopen the payment page. */}
        {handoff?.blocked && (
          <a
            className={styles.continueLink}
            href={handoff.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Continue with{" "}
            {displayRamp ? getOnrampDisplayName(onramps, displayRamp) : "your provider"}
          </a>
        )}

        {/* Bridge-side estimate from the Deposit API's config/assets (same value
            as the deposit-address details screen); excludes the provider's
            payment/KYC and delivery time, which nothing exposes. */}
        <p className={styles.duration}>
          Estimated duration{" "}
          <span className={styles.durationValue}>
            <ProcessingTimeValue estimate={processingTime} />
          </span>
        </p>

        <p className={styles.note}>Your transaction will continue even if you close this.</p>

        {/* Without the deposit address, detection can never match and this screen
            would stay on "Processing…" forever after paying (the checkout itself
            proceeds — the Deposit API re-derives the address server-side). The
            failure surfaces inline with Retry the only recovery. */}
        {isAddressError && (
          <>
            <DepositStatus error>
              Deposit detection is unavailable. We couldn't prepare your deposit address. Your
              purchase is unaffected.
            </DepositStatus>
            <Button.White onClick={() => void refetchAddress()}>Retry</Button.White>
          </>
        )}

        {/* Advance to tracking relies on this polling; a failure leaves the user
            with no feedback after paying (the purchase is unaffected). Hidden
            behind the address error, which is the more fundamental one. */}
        {isDetectionError && !isAddressError && (
          <DepositStatus error>
            Deposit detection is temporarily unavailable. Your purchase is unaffected; it will
            appear once the connection recovers.
          </DepositStatus>
        )}

        <FlowChips
          steps={[
            {
              label: "Pay",
              icon: <FiatFlag fiatId={fiatId} size={20} />,
              text: fiatDisplayCode,
            },
            // The purchase buys the destination's SOURCE crypto (e.g. Ethereum
            // USDC); the bridge then delivers the destination asset.
            {
              label: "Buy",
              logoUrl: buyLogoUrl,
              chainLogoUrl: buyChainLogoUrl,
              text: buySymbol,
            },
            {
              label: "Receive",
              logoUrl: receiveAsset.logoUrl,
              chainLogoUrl: receiveAsset.chainLogoUrl,
              text: receiveSymbol,
            },
          ]}
        />

        {/* The deposit (forwarding) address the provider pays out to, labeled
            as such so it isn't mistaken for the user's wallet — shown here so
            the user can cross-check it against the address on the provider's
            payment page. The chain is the source network the provider sends
            on (the Buy chip's), not the destination. */}
        {depositAddress && (
          <div className={styles.addressSection}>
            <div className={styles.addressHeader}>
              <span>Deposit address</span>
              {buyChainName && (
                <span className={styles.addressChain}>
                  <Image
                    src={buyChainLogoUrl}
                    width={16}
                    height={16}
                    className={styles.addressChainLogo}
                    classNames={{ placeholder: styles.addressChainLogo }}
                  />
                  {buyChainName}
                </span>
              )}
            </div>

            <CopyButton value={depositAddress}>
              {({ copy, copied }) => (
                <button
                  type="button"
                  className={styles.addressField}
                  onClick={copy}
                  aria-label={copied ? "Copied" : "Copy deposit address"}
                >
                  <span className={styles.addressValue}>{depositAddress}</span>
                  {copied ? (
                    <IconCheck size={12} aria-hidden="true" />
                  ) : (
                    <IconCopy size={12} aria-hidden="true" />
                  )}
                </button>
              )}
            </CopyButton>

            {displayRamp && buySymbol && (
              <p className={styles.addressCaption}>
                {getOnrampDisplayName(onramps, displayRamp)} sends {buySymbol} here, then to{" "}
                <span className={styles.addressOwner}>your wallet ({truncate(walletAddress)})</span>
                . This should match the address on {getOnrampDisplayName(onramps, displayRamp)}
                &apos;s page.
              </p>
            )}
          </div>
        )}
      </div>
    </DepositSubpage>
  )
}

interface CheckoutFailureProps {
  error: Error
  resetErrorBoundary: () => void
}

/** In-flow checkout failure screen: the error with Retry and a way back. */
const CheckoutFailure = ({ error, resetErrorBoundary }: CheckoutFailureProps) => {
  const navigate = useDepositNavigate()
  const queryClient = useQueryClient()

  // Reset errored suspense queries with the boundary, or remount rethrows the
  // cached error.
  const retry = () => {
    queryClient.resetQueries({ queryKey: depositQueryKeys.assets.queryKey })
    queryClient.resetQueries({ queryKey: depositQueryKeys.onramperSupported.queryKey })
    queryClient.resetQueries({ queryKey: depositQueryKeys.onramperOnramps.queryKey })
    resetErrorBoundary()
  }

  return (
    <DepositSubpage title="Processing…" onBack={() => navigate("onramp")}>
      <DepositStatus error>{error.message}</DepositStatus>
      <Footer>
        <Button.White onClick={retry}>Retry</Button.White>
      </Footer>
    </DepositSubpage>
  )
}

// Local boundary so a checkout failure lands on an in-flow screen with Retry and
// a way back, not the modal-level fallback (a bare message with no next step).
// Retry needs no manual state reset: remounting the body recreates `uuid` and
// `startedRef`, so it runs a fresh checkout under a new idempotency key.
const OnrampProcessing = () => (
  <AsyncBoundary
    errorBoundaryProps={{
      // The fallback hides the cause; log it for diagnosis.
      // eslint-disable-next-line no-console
      onError: (error) => console.error(error),
      fallbackRender: ({ error, resetErrorBoundary }) => (
        <CheckoutFailure error={error} resetErrorBoundary={resetErrorBoundary} />
      ),
    }}
  >
    <OnrampProcessingBody />
  </AsyncBoundary>
)

export default OnrampProcessing
