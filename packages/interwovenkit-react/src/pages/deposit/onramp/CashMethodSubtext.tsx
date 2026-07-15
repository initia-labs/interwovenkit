import { useDepositForm } from "../context"
import { useOnramperFiat, useOnramperPaymentTypes, useOnramperSourceCrypto } from "./data/onramper"
import { formatMaxPurchaseLabel, maxAggregatedLimit } from "./data/onramperLogic"

/** Static cash subtext, shown until a purchase limit is known (and as the
 * boundary fallback while limits load or when they fail). */
export const CASH_SUBTEXT_FALLBACK = "Card or bank transfer"

/**
 * Live cash subtext: the maximum purchase for the current fiat and the
 * destination's Onramper source asset, e.g. "Up to $20,000" (the widest
 * `aggregatedLimit` across payment types — no method is chosen yet on this
 * screen, so the copy reads as a ceiling hint, not the selected method's
 * limit; see formatMaxPurchaseLabel). Falls back to the static copy while the
 * payment-types query loads or when nothing reports a max. Suspends on the
 * Onramper supported list, so it must render behind the method hub's local
 * AsyncBoundary.
 */
const CashMethodSubtext = () => {
  const { watch } = useDepositForm()
  const fiatId = watch("fiatId")
  const receiveDenom = watch("receiveDenom")
  const receiveChainId = watch("receiveChainId")
  const fiat = useOnramperFiat(fiatId)
  const sourceCrypto = useOnramperSourceCrypto(receiveChainId, receiveDenom)
  const paymentTypes = useOnramperPaymentTypes(fiatId, sourceCrypto?.id ?? "")
  const max = maxAggregatedLimit(paymentTypes.data ?? [])
  if (max === undefined || !fiat) return CASH_SUBTEXT_FALLBACK
  return formatMaxPurchaseLabel(max, fiat.symbol)
}

export default CashMethodSubtext
