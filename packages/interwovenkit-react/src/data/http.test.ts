import { normalizeErrorMessage, POPUP_BLOCKED_MESSAGE } from "./http"

describe("normalizeErrorMessage", () => {
  it("explains a blocked wallet popup instead of passing Privy's message through", async () => {
    // viem wraps the Privy error as a ProviderRpcError whose cause carries the raw text.
    const error = new Error("An unknown RPC error occurred.", {
      cause: new Error("Failed to initialize request"),
    })

    expect(await normalizeErrorMessage(error)).toBe(POPUP_BLOCKED_MESSAGE)
  })

  it("prefers the cause message over the outer message", async () => {
    const error = new Error("outer", { cause: new Error("inner") })
    expect(await normalizeErrorMessage(error)).toBe("inner")
  })

  it("maps wallet rejection codes", async () => {
    expect(await normalizeErrorMessage(Object.assign(new Error("denied"), { code: 4001 }))).toBe(
      "User rejected",
    )
  })

  it("stringifies non-error values", async () => {
    expect(await normalizeErrorMessage("plain")).toBe("plain")
  })
})
