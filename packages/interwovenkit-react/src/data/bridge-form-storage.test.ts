import { clearPersistedBridgeFormValues } from "./bridge-form-storage"
import { LocalStorageKey } from "./constants"

describe("clearPersistedBridgeFormValues", () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    storage.clear()
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value)
      },
      removeItem: (key: string) => {
        storage.delete(key)
      },
      clear: () => {
        storage.clear()
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("removes persisted bridge form values including recipient", () => {
    localStorage.setItem(LocalStorageKey.BRIDGE_SRC_CHAIN_ID, "interwoven-1")
    localStorage.setItem(LocalStorageKey.BRIDGE_SRC_DENOM, "uinit")
    localStorage.setItem(LocalStorageKey.BRIDGE_DST_CHAIN_ID, "initiation-2")
    localStorage.setItem(LocalStorageKey.BRIDGE_DST_DENOM, "uusdc")
    localStorage.setItem(LocalStorageKey.BRIDGE_QUANTITY, "1")
    localStorage.setItem(LocalStorageKey.BRIDGE_SLIPPAGE_PERCENT, "0.5")
    localStorage.setItem(LocalStorageKey.BRIDGE_RECIPIENT, "init1recipient")
    localStorage.setItem(LocalStorageKey.PUBLIC_KEY, "pubkey")

    clearPersistedBridgeFormValues()

    expect(localStorage.getItem(LocalStorageKey.BRIDGE_SRC_CHAIN_ID)).toBeNull()
    expect(localStorage.getItem(LocalStorageKey.BRIDGE_SRC_DENOM)).toBeNull()
    expect(localStorage.getItem(LocalStorageKey.BRIDGE_DST_CHAIN_ID)).toBeNull()
    expect(localStorage.getItem(LocalStorageKey.BRIDGE_DST_DENOM)).toBeNull()
    expect(localStorage.getItem(LocalStorageKey.BRIDGE_QUANTITY)).toBeNull()
    expect(localStorage.getItem(LocalStorageKey.BRIDGE_SLIPPAGE_PERCENT)).toBeNull()
    expect(localStorage.getItem(LocalStorageKey.BRIDGE_RECIPIENT)).toBeNull()
    expect(localStorage.getItem(LocalStorageKey.PUBLIC_KEY)).toBe("pubkey")
  })
})
