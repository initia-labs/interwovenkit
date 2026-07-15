import clsx from "clsx"
import { useEffect } from "react"
import { IconChevronDown } from "@initia/icons-react"
import Button from "@/components/Button"
import Collapsible from "@/components/Collapsible"
import DetailRow from "@/components/DetailRow"
import Footer from "@/components/Footer"
import FormHelp from "@/components/form/FormHelp"
import NumericInput from "@/components/form/NumericInput"
import Image from "@/components/Image"
import { LocalStorageKey } from "@/data/constants"
import { useProcessingTime, useReceiveAsset } from "../data/assets"
import { DEFAULT_FIAT_ID, useDepositForm, useDepositNavigate } from "../context"
import DepositSubpage from "../DepositSubpage"
import ProcessingTimeValue from "../ProcessingTimeValue"
import { useMinReceived } from "./data/minReceived"
import {
  useFiatDisplayCode,
  useOnramperPaymentTypes,
  useOnramperRecommendedFiatCode,
  useOnramperSourceRoute,
  useOnramperSupported,
  useOnrampsMetadata,
} from "./data/onramper"
import { getOnrampDisplayName, resolveFiatAnchor } from "./data/onramperLogic"
import FiatFlag from "./FiatFlag"
import PaymentMethodIcon from "./PaymentMethodIcon"
import ProviderLogo from "./ProviderLogo"
import type { OnrampQuote } from "./quote"
import { useOnrampQuote } from "./quote"
import styles from "./OnrampFields.module.css"

// Submit gate copy per quote state; undefined enables the Buy button. Exhaustive
// map over the quote union, not a priority chain; the `satisfies never` return
// makes the compiler enforce it — a missed case would fall through to an enabled
// Buy button (fail-open) on a no-refund purchase.
function submitDisabledMessage(quote: OnrampQuote): string | undefined {
  switch (quote.status) {
    case "unsupported":
      return "Not available for this asset"
    case "idle":
      return "Enter amount"
    case "limit-error":
      return "Amount out of range"
    case "loading":
      return "Getting quote…"
    case "error":
      return "Quote unavailable"
    case "no-offers":
      return "No quote available"
    case "quoted":
      return quote.belowRouteMinimum ? "Amount too low" : undefined
  }
  return quote satisfies never
}

// Submit-blocking reason for the footer: each blocked state carries its own
// actionable message (fiat bound, quotes failure, provider reason, bridge
// minimum), so the user knows how to fix the request.
function submitBlockedReason(quote: OnrampQuote): string {
  switch (quote.status) {
    case "limit-error":
    case "error":
      return quote.message
    case "no-offers":
      return quote.reason
    case "quoted":
      return quote.belowRouteMinimum
        ? `This purchase is below the ${quote.routeMinimumLabel} bridge minimum. Increase your amount.`
        : ""
    default:
      return ""
  }
}

/** Buy form: pay fiat, receive crypto. The receive selection is the
 * Initia destination; the live quote buys its Onramper source asset. Each
 * selection opens a sub-page; submit advances to the processing screen. */
const OnrampFields = () => {
  const { control, watch, setValue, handleSubmit } = useDepositForm()
  const navigate = useDepositNavigate()
  const quote = useOnrampQuote()
  const onramps = useOnrampsMetadata()

  const fiatId = watch("fiatId")
  const receiveSymbol = watch("receiveSymbol")
  const receiveDenom = watch("receiveDenom")
  const receiveChainId = watch("receiveChainId")
  const paymentMethodId = watch("paymentMethodId")

  // No ahead-of-typing minimum hint here on purpose: the deposit route's minimum
  // is in crypto units while the Pay input takes fiat, so surfacing it misleads
  // (e.g. "5 ETH" read as fiat 5). Limits are enforced in four layers once an
  // amount is typed, all blocking submit with an actionable footer reason: (1)
  // the payment type's aggregated fiat bounds, before any quotes request
  // (limit-error state); (2) per-provider floors, via empty quotes plus the
  // provider's reason (no-offers state); (3) the bridge minimum on the quoted
  // payout (belowRouteMinimum) — Onramper accepts but the bridge strands the
  // funds; (4) the backend pre-quote's refusal (useMinReceived's isDeclined),
  // the backend-signaled counterpart of (3) when the config/assets snapshot
  // behind (3) lags the backend's live minimum.
  const receiveAsset = useReceiveAsset({
    denom: receiveDenom,
    chainId: receiveChainId,
    symbol: receiveSymbol,
  })
  const paymentTypes = useOnramperPaymentTypes(fiatId, quote.sourceCryptoId)
  const paymentMethod = paymentTypes.data?.find(
    (method) => method.paymentTypeId === paymentMethodId,
  )

  // Payment types are per fiat -> crypto pair, so a fiat (or receive-asset)
  // switch can leave the form holding a method the new pair doesn't offer. Left
  // stale, it disarms the pre-quote limit gate (findAggregatedLimit misses) and
  // every /quotes request carries an unsupported paymentMethod (providers
  // decline, user sees "No quote available"). Re-anchor to the first offered type.
  useEffect(() => {
    const types = paymentTypes.data
    if (!types?.length) return
    if (types.some((method) => method.paymentTypeId === paymentMethodId)) return
    setValue("paymentMethodId", types[0].paymentTypeId)
  }, [paymentTypes.data, paymentMethodId, setValue])

  // Same guard for the fiat, plus localization: converge the form's fiat on
  // resolveFiatAnchor's pick (see its JSDoc). Convergence is unconditional
  // because every other fiat writer agrees with the anchor (the seed is the
  // persisted pick or the static default, and SelectFiat persists each pick), so
  // the effect only rewrites the two automatic seeds. The result is deliberately
  // not persisted: an automatic substitution must not overwrite the user's
  // preference. Both lists resolve via suspense, so the effect never runs against
  // a loading placeholder and settles on the first commit.
  const { fiat: supportedFiat } = useOnramperSupported()
  const recommendedFiatCode = useOnramperRecommendedFiatCode()
  useEffect(() => {
    const anchor = resolveFiatAnchor(supportedFiat, {
      persistedId: localStorage.getItem(LocalStorageKey.ONRAMP_FIAT_ID),
      recommendedCode: recommendedFiatCode,
      defaultId: DEFAULT_FIAT_ID,
    })
    if (fiatId === anchor.id) return
    setValue("fiatId", anchor.id)
  }, [supportedFiat, recommendedFiatCode, fiatId, setValue])

  const quoted = quote.status === "quoted" ? quote : null
  const provider = quoted?.selected ?? null

  const minReceived = useMinReceived(provider?.payout, receiveChainId, receiveDenom)

  // Bridge-side estimate from the Deposit API's `config/assets`, same value as
  // the processing screen. It excludes the provider's payment/KYC and delivery
  // time, which nothing exposes.
  const sourceRoute = useOnramperSourceRoute(receiveChainId, receiveDenom)
  const processingTime = useProcessingTime(sourceRoute?.route, receiveChainId, receiveDenom)

  const fiat = useFiatDisplayCode(fiatId)

  // The backend-declined gate (layer 4) lives outside submitDisabledMessage on
  // purpose: that map is exhaustive over the Onramper quote union, and this
  // signal comes from the deposit service pre-quote. While the pre-quote is
  // unsettled the verdict is unknown, so submit stays blocked (fail closed); a
  // pre-quote failing through the transient channel (isFailed) reads as a
  // failure, not "Getting quote…" forever. The footer prefers the backend's
  // decline message; the generic copy hedges because a 400 can also mean an
  // unconfigured or paused route, not only a sub-minimum payout.
  const disabledMessage =
    submitDisabledMessage(quote) ??
    (minReceived.isDeclined || minReceived.isFailed ? "Quote unavailable" : undefined) ??
    (!minReceived.isSettled ? "Getting quote…" : undefined)
  const blockedReason =
    submitBlockedReason(quote) ||
    (minReceived.isDeclined
      ? minReceived.declineReason ||
        "The bridge can't quote this purchase. It may be below the route minimum. Try increasing your amount."
      : "") ||
    (minReceived.isFailed
      ? "Couldn't reach the bridge for a quote. It retries automatically. Check your connection if this persists."
      : "")

  // Guard the submit callback too (defense in depth): submission can fire through
  // paths other than the disabled button.
  const submit = handleSubmit(() => {
    if (disabledMessage) return
    navigate("onramp-processing")
  })

  return (
    // Title rule: see DepositSubpage's `title`; cash/card is dropped since no
    // payment method is chosen yet.
    <DepositSubpage title={`Buy ${receiveSymbol}`} onBack={() => navigate("select-method")}>
      <form className={styles.form} onSubmit={submit} aria-label="Buy crypto form">
        <div className={styles.card}>
          <div className={styles.field}>
            <p className={styles.fieldLabel}>Pay</p>
            <div className={styles.fieldMain}>
              <button
                type="button"
                className={styles.pill}
                onClick={() => navigate("onramp-select-fiat")}
              >
                <FiatFlag fiatId={fiatId} size={24} />
                {fiat}
                <IconChevronDown size={16} className={styles.pillChevron} aria-hidden="true" />
              </button>

              <NumericInput
                name="fiatAmount"
                control={control}
                dp={2}
                className={styles.amount}
                aria-label="Amount to pay"
              />
            </div>
          </div>

          <div className={styles.divider} />

          <div className={styles.field}>
            <p className={styles.fieldLabel}>
              Receive
              <span className={styles.fieldLabelChain}>
                on
                <Image
                  src={receiveAsset.chainLogoUrl}
                  width={18}
                  height={18}
                  className={styles.chainLogo}
                  classNames={{ placeholder: styles.chainLogo }}
                />
                {receiveAsset.chainName}
              </span>
            </p>
            <div className={styles.fieldMain}>
              <button
                type="button"
                className={styles.pill}
                onClick={() => navigate("onramp-select-receive")}
              >
                <Image
                  src={receiveAsset.logoUrl}
                  width={24}
                  height={24}
                  className={styles.coin}
                  classNames={{ placeholder: styles.coin }}
                />
                {receiveAsset.symbol}
                <IconChevronDown size={16} className={styles.pillChevron} aria-hidden="true" />
              </button>

              <p className={clsx(styles.amountReadOnly, { [styles.placeholder]: !provider })}>
                {quoted?.receiveAmount ?? "0"}
              </p>
            </div>
          </div>
        </div>

        <div>
          <p className={styles.sectionLabel}>Payment method</p>
          <button
            type="button"
            className={styles.methodField}
            onClick={() => navigate("onramp-select-payment")}
          >
            <span className={styles.methodLeft}>
              <PaymentMethodIcon iconUrl={paymentMethod?.icon} size={32} />
              {paymentMethod?.name ?? "Select payment method"}
            </span>
            <IconChevronDown size={16} className={styles.pillChevron} aria-hidden="true" />
          </button>
        </div>

        <Collapsible title="Transaction details" defaultOpen>
          <DetailRow label="Provider">
            <button
              type="button"
              className={styles.providerPill}
              onClick={() => navigate("onramp-select-provider")}
              disabled={!provider}
            >
              {provider ? (
                <>
                  <ProviderLogo ramp={provider.ramp} size={16} />
                  {getOnrampDisplayName(onramps, provider.ramp)}
                </>
              ) : (
                "—"
              )}
              <IconChevronDown size={12} className={styles.pillChevron} aria-hidden="true" />
            </button>
          </DetailRow>

          <DetailRow label="Estimated price">{quoted?.estimatedPriceLabel ?? "—"}</DetailRow>
          <DetailRow label="Estimated time">
            <ProcessingTimeValue estimate={processingTime} />
          </DetailRow>
          {/* The Onramper quote's networkFee + transactionFee (see totalQuoteFee).
              Providers split the two differently and their checkout can charge
              more, so the label claims a total, not a specific fee type. */}
          <DetailRow label="Total fees">{quoted?.feeLabel ?? "—"}</DetailRow>
          {/* The real minimum after the backend's policy slippage, from its
              pre-quote on the payout (see useMinReceived). "—" until the first
              estimate resolves; a declined payout (400) also shows "—" and blocks
              submit (see disabledMessage above). */}
          <DetailRow label="Minimum received" emphasized>
            <Image
              src={receiveAsset.logoUrl}
              width={14}
              height={14}
              className={styles.coin}
              classNames={{ placeholder: styles.coin }}
            />
            {minReceived.value ? `${minReceived.value} ${receiveSymbol}` : "—"}
          </DetailRow>
        </Collapsible>

        {/* Submit-blocking reason as the footer's FormHelp, like the other forms
            (see submitBlockedReason). */}
        <Footer extra={blockedReason && <FormHelp level="error">{blockedReason}</FormHelp>}>
          <Button.White type="submit" fullWidth disabled={!!disabledMessage}>
            {disabledMessage ?? `Buy ${receiveSymbol}`}
          </Button.White>
        </Footer>
      </form>
    </DepositSubpage>
  )
}

export default OnrampFields
