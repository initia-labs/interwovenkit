import { useCallback } from "react"
import { useFormContext } from "react-hook-form"

export type DepositPage =
  // Hub: pick the receive asset, then the method
  | "select-asset"
  | "select-method"
  // Method entry pages, keyed by method id (see DepositMethod)
  | "wallet"
  | "address"
  | "onramp"
  // Onramp sub-pages
  | "onramp-select-fiat"
  | "onramp-select-receive"
  | "onramp-select-payment"
  | "onramp-select-provider"
  | "onramp-processing"
  // Tracking terminal shared by the address and onramp methods
  | "track"

/** Onramper fiat id (lowercase): the static fallback candidate for the
 * onramp-path currency (see resolveFiatAnchor for the full priority), and the
 * synchronous form seed when no remembered pick exists. */
export const DEFAULT_FIAT_ID = "usd"
/** Onramper paymentTypeId used as the initial onramp-path payment method. */
export const DEFAULT_PAYMENT_TYPE_ID = "creditcard"

/**
 * How funds reach the deposit address; picks the terminal screen's copy.
 * Ids double as entry page keys and method folder names. The wallet method is
 * absent: it opens its page directly and never reaches the shared terminal.
 */
export type DepositMethod = "address" | "onramp"

/**
 * Single hub form shared by every deposit path: the receive asset has many live
 * readers (onramp rewrites it, the hub cards and track terminal read it), and
 * pages swap on the `page` field, so a path-local form would unmount and lose
 * input on hub round-trips. The wallet path is the exception — TransferFlow
 * keeps its own RHF form — because Withdraw reuses it standalone.
 */
export interface DepositFormValues {
  page: DepositPage
  // Crypto to receive (the Initia destination)
  receiveSymbol: string
  receiveDenom: string
  receiveChainId: string
  // Selected deposit method ("address" = manual transfer to the deposit
  // address, "onramp" = Onramper purchase).
  method: DepositMethod
  // Onramp path (Onramper). `fiatId` holds the Onramper fiat id (lowercase, e.g.
  // "usd") — never the uppercase ISO code, which lives on `OnramperFiat.code`
  // and is looked up for display. `paymentMethodId` holds the paymentTypeId
  // (e.g. "creditcard"), `providerId` the selected ramp ("" = auto-pick the
  // best-payout provider).
  fiatId: string
  fiatAmount: string
  paymentMethodId: string
  providerId: string
}

export function useDepositForm() {
  return useFormContext<DepositFormValues>()
}

/**
 * Navigate between flow pages by mutating the form's `page` field. Stable
 * identity (useCallback on RHF's stable setValue) is load-bearing: the
 * auto-advance effects (DepositAddress, OnrampProcessing) list this in their
 * deps, and an unstable reference re-arms them mid-transition, cascading
 * setValue into React's "Maximum update depth exceeded".
 */
export function useDepositNavigate() {
  const { setValue } = useDepositForm()
  return useCallback((page: DepositPage) => setValue("page", page), [setValue])
}

/**
 * Selects a deposit method and advances to its first page in one call, so a
 * caller cannot half-apply the `method`/`page` pair that drives the shared
 * tracking screen's terminal copy.
 */
export function useSelectDepositMethod() {
  const { setValue } = useDepositForm()
  const navigate = useDepositNavigate()
  return useCallback(
    (method: DepositMethod) => {
      setValue("method", method)
      navigate(method)
    },
    [setValue, navigate],
  )
}
