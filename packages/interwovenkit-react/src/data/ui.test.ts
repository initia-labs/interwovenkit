import { describe, expect, it, vi } from "vitest"
import { LocalStorageKey } from "./constants"
import { clearDisconnectState } from "./ui"

describe("clearDisconnectState", () => {
  it("clears the react query cache alongside the other disconnect state", () => {
    const queryClient = { clear: vi.fn() }
    const clearSSECache = vi.fn()
    const storage = new Map<string, string>()

    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value)
      },
      removeItem: (key: string) => {
        storage.delete(key)
      },
    })

    localStorage.setItem(LocalStorageKey.BRIDGE_SRC_CHAIN_ID, "initia-1")
    localStorage.setItem(`${LocalStorageKey.PUBLIC_KEY}:init1test`, "abcd")

    clearDisconnectState({
      queryClient,
      clearSSECache,
      address: "init1test",
    })

    expect(queryClient.clear).toHaveBeenCalledTimes(1)
    expect(clearSSECache).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(LocalStorageKey.BRIDGE_SRC_CHAIN_ID)).toBeNull()
    expect(localStorage.getItem(`${LocalStorageKey.PUBLIC_KEY}:init1test`)).toBeNull()
  })
})
