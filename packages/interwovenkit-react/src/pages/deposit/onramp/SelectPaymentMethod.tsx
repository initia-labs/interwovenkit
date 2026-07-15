import { IconCheck } from "@initia/icons-react"
import { LocalStorageKey } from "@/data/constants"
import { useDepositForm, useDepositNavigate } from "../context"
import DepositStatus from "../DepositStatus"
import DepositSubpage from "../DepositSubpage"
import {
  useApplePayOnlyHidden,
  useOnramperPaymentTypes,
  useOnramperSourceCrypto,
} from "./data/onramper"
import PaymentMethodIcon from "./PaymentMethodIcon"
import styles from "./SelectPaymentMethod.module.css"

/** Payment method picker: Onramper payment types for the chosen
 * fiat -> source-crypto pair. Fails loudly inline. */
const SelectPaymentMethod = () => {
  const { watch, setValue } = useDepositForm()
  const navigate = useDepositNavigate()

  const fiatId = watch("fiatId")
  const paymentMethodId = watch("paymentMethodId")
  const receiveDenom = watch("receiveDenom")
  const receiveChainId = watch("receiveChainId")

  const sourceCrypto = useOnramperSourceCrypto(receiveChainId, receiveDenom)
  const {
    data: methods,
    isPending,
    isError,
    error,
  } = useOnramperPaymentTypes(fiatId, sourceCrypto?.id ?? "")
  const applePayOnlyHidden = useApplePayOnlyHidden(fiatId, sourceCrypto?.id ?? "")

  const renderList = () => {
    // No Onramper source crypto for this destination: the payment-types query
    // is permanently disabled (isPending never resolves), so the condition must
    // read as unsupported — not as an eternal "Loading…".
    if (!sourceCrypto) return <DepositStatus>Not available for this asset</DepositStatus>
    if (isError) return <DepositStatus error>{error.message}</DepositStatus>
    if (isPending) return <DepositStatus>Loading…</DepositStatus>
    // An empty list caused by the browser-capability filter names the actual
    // fix; a bare "No payment methods" would read as a pair with none at all.
    if (methods.length === 0) {
      return (
        <DepositStatus>
          {applePayOnlyHidden
            ? "The only payment method for this pair is Apple Pay, which this browser can't complete. Try Safari or an iOS browser."
            : "No payment methods"}
        </DepositStatus>
      )
    }
    return methods.map((method) => (
      <DepositSubpage.Row
        key={method.paymentTypeId}
        onClick={() => {
          setValue("paymentMethodId", method.paymentTypeId)
          // Remember explicit picks only, as the next session's default
          // (buildDepositDefaultValues). OnrampFields' re-anchor fallback
          // stays unpersisted on purpose: a pair-specific substitution must
          // not overwrite the user's actual preference.
          localStorage.setItem(LocalStorageKey.ONRAMP_PAYMENT_TYPE_ID, method.paymentTypeId)
          navigate("onramp")
        }}
      >
        <PaymentMethodIcon iconUrl={method.icon} size={28} />
        <span className={styles.name}>{method.name}</span>
        {paymentMethodId === method.paymentTypeId && (
          <IconCheck size={16} className={styles.check} aria-hidden="true" />
        )}
      </DepositSubpage.Row>
    ))
  }

  return (
    <DepositSubpage title="Select payment method" onBack={() => navigate("onramp")}>
      <DepositSubpage.List>{renderList()}</DepositSubpage.List>
    </DepositSubpage>
  )
}

export default SelectPaymentMethod
