import { makeError } from "ethers"
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
      ["a request cancelled by the user", new Error("Request cancelled by the user")],
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
      ["cause.error", (inner: unknown) => new Error("outer", { cause: { error: inner } })],
    ])("finds a rejection nested in %s", async (_name, wrap) => {
      expect(await normalizeErrorMessage(wrap(withCode(5000)))).toBe(USER_REJECTED_MESSAGE)
    })

    it("survives a cyclic error chain", async () => {
      const error: Error & { error?: unknown } = new Error("execution reverted")
      error.error = new Error("internal error", { cause: error })
      expect(await normalizeErrorMessage(error)).toBe("internal error")
    })

    // A false match would let a transfer that was sent be offered for signing again.
    it.each([
      [
        "a refused HTTP request",
        withCode(-32000, "Request rejected (403)"),
        "Request rejected (403)",
      ],
      ["a backend decline", withCode(-32000, "declined"), "declined"],
      [
        "a cancellation that doesn't say the user refused",
        new Error("Transaction cancelled"),
        "Transaction cancelled",
      ],
      ["EIP-1193 4100", withCode(4100, "Unauthorized"), "Unauthorized"],
      [
        "a message about the user that is not a refusal",
        new Error("User operation reverted"),
        "User operation reverted",
      ],
      [
        "a broadcast transaction ethers reports as cancelled by replacement",
        makeError("transaction was replaced", "TRANSACTION_REPLACED", {
          cancelled: true,
          reason: "cancelled",
          hash: `0x${"a".repeat(64)}`,
          replacement: {} as never,
          receipt: {} as never,
        }),
        "transaction was replaced",
      ],
    ])("passes %s through", async (_name, error, expected) => {
      expect(await normalizeErrorMessage(error)).toBe(expected)
    })
  })

  it("stringifies non-error values", async () => {
    expect(await normalizeErrorMessage("plain")).toBe("plain")
  })
})
