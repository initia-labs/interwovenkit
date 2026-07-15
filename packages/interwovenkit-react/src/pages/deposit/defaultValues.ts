import type { AssetOption } from "./data/assetOptions"
import { DEFAULT_FIAT_ID, DEFAULT_PAYMENT_TYPE_ID, type DepositFormValues } from "./context"

/**
 * Onramp selections remembered from the user's last explicit picks
 * (SelectPaymentMethod / SelectFiat persist them); the caller reads them from
 * localStorage so `buildDepositDefaultValues` stays pure.
 */
export interface PersistedOnrampDefaults {
  paymentMethodId?: string | null
  fiatId?: string | null
}

/**
 * Initial hub form values for the host-provided assets. With a single local
 * asset there is nothing to pick, so pre-select it and land on the method hub,
 * skipping the picker. Its symbol isn't known synchronously; SyncReceiveSymbol
 * (Deposit) fills it in.
 *
 * Remembered onramp selections are safe to seed even when no longer offered:
 * OnrampFields re-anchors once the live lists load (payment method to the
 * pair's first offered type, fiat to resolveFiatAnchor's pick). The static fiat
 * seeded here only bridges the frames before that anchor settles.
 */
export function buildDepositDefaultValues(
  localOptions: AssetOption[],
  persisted: PersistedOnrampDefaults = {},
): DepositFormValues {
  const defaultValues: DepositFormValues = {
    page: "select-asset",
    receiveSymbol: "",
    receiveDenom: "",
    receiveChainId: "",
    method: "address",
    fiatId: persisted.fiatId || DEFAULT_FIAT_ID,
    fiatAmount: "",
    paymentMethodId: persisted.paymentMethodId || DEFAULT_PAYMENT_TYPE_ID,
    providerId: "",
  }

  if (localOptions.length === 1) {
    const [{ denom, chainId }] = localOptions
    defaultValues.receiveDenom = denom
    defaultValues.receiveChainId = chainId
    defaultValues.page = "select-method"
  }

  return defaultValues
}
