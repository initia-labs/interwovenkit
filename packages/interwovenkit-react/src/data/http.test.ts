import { normalizeErrorMessage, POPUP_BLOCKED_MESSAGE, USER_REJECTED_MESSAGE } from "./http"

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

  describe("wallet rejections", () => {
    const withCode = (code: unknown, message = "failed") =>
      Object.assign(new Error(message), { code })

    it.each([
      ["numeric 4001", withCode(4001)],
      ["string 4001", withCode("4001")],
      ["bigint 4001", withCode(4001n)],
      ["WalletConnect 5000", withCode(5000)],
      ["ethers ACTION_REJECTED", withCode("ACTION_REJECTED")],
      ["SafePal", new Error("Transaction cancelled by user")],
      ["Trust", new Error("User canceled")],
      ["Coinbase", new Error("User denied transaction signature.")],
      ["Fireblocks and WalletConnect", new Error("User rejected.")],
      ["Binance", new Error("Closed modal")],
      ["a cancelled transaction", new Error("Transaction cancelled")],
      ["a plain object", { code: 4001, message: "denied" }],
    ])("maps %s", async (_name, error) => {
      expect(await normalizeErrorMessage(error)).toBe(USER_REJECTED_MESSAGE)
    })

    it.each([
      ["cause", (inner: unknown) => new Error("outer", { cause: inner })],
      [
        "ethers info.error",
        (inner: unknown) => Object.assign(new Error("outer"), { info: { error: inner } }),
      ],
      ["error", (inner: unknown) => Object.assign(new Error("outer"), { error: inner })],
      [
        "originalError",
        (inner: unknown) => Object.assign(new Error("outer"), { originalError: inner }),
      ],
      [
        "data.originalError",
        (inner: unknown) => Object.assign(new Error("outer"), { data: { originalError: inner } }),
      ],
      [
        "details",
        () => Object.assign(new Error("outer"), { details: "User rejected the request." }),
      ],
    ])("finds a rejection nested in %s", async (_name, wrap) => {
      expect(await normalizeErrorMessage(wrap(withCode(5000)))).toBe(USER_REJECTED_MESSAGE)
    })

    it("survives a cyclic error chain", async () => {
      const error: Error & { error?: unknown } = new Error("execution reverted")
      error.error = new Error("internal error", { cause: error })
      expect(await normalizeErrorMessage(error)).toBe("internal error")
    })

    it.each([
      "execution reverted",
      "nonce too low",
      "Request rejected (403)",
      "request timed out",
      "internal error",
      "declined",
    ])("passes %s through", async (message) => {
      expect(await normalizeErrorMessage(withCode(-32000, message))).toBe(message)
    })
  })

  it("stringifies non-error values", async () => {
    expect(await normalizeErrorMessage("plain")).toBe("plain")
  })
})
