import { LocalStorageKey } from "./constants"

const BRIDGE_FORM_LOCAL_STORAGE_KEYS = [
  LocalStorageKey.BRIDGE_SRC_CHAIN_ID,
  LocalStorageKey.BRIDGE_SRC_DENOM,
  LocalStorageKey.BRIDGE_DST_CHAIN_ID,
  LocalStorageKey.BRIDGE_DST_DENOM,
  LocalStorageKey.BRIDGE_QUANTITY,
  LocalStorageKey.BRIDGE_SLIPPAGE_PERCENT,
  LocalStorageKey.BRIDGE_RECIPIENT,
]

export function clearPersistedBridgeFormValues() {
  for (const key of BRIDGE_FORM_LOCAL_STORAGE_KEYS) {
    localStorage.removeItem(key)
  }
}
