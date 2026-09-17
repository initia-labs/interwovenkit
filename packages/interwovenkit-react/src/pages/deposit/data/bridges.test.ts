import { describe, expect, it } from "vitest"
import {
  bridgeQuoteSignature,
  type BridgeRequestIdentity,
  BridgeStatusConflictError,
  bridgeStatusPollInterval,
  classifyBridgeStatusError,
  createBridgeOptionsQueryOptions,
  createBridgeQuoteQueryOptions,
  createBridgeStatusQueryOptions,
  meetsRequiredMinimum,
  parseBridgeOptions,
  parseBridgeQuote,
  parseBridgeStatus,
  percentDifference,
  rankBridgeOptions,
} from "./bridges"
import {
  deposit,
  DEPOSIT_ADDRESS,
  DST_TX_HASH,
  httpError,
  option,
  RECIPIENT,
  SRC_TX_HASH,
  stubApi,
} from "./testing"
import type { BridgeOption } from "./types"
import { BRIDGE_STATUS_ERROR_CODES } from "./types"

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const SPENDER = "0x1111111111111111111111111111111111111111"
const BRIDGE_ROUTER = "0x2222222222222222222222222222222222222222"
const SENDER = "0x3333333333333333333333333333333333333333"

const REQUEST: BridgeRequestIdentity = {
  srcChainId: "8453",
  srcDenom: BASE_USDC,
  dstChainId: "interwoven-1",
  dstDenom: "uusdc",
  amount: "5000000",
  fromAddress: SENDER,
  walletAddress: RECIPIENT,
}

const QUOTE_REQUEST = { ...REQUEST, bridge: "across", sourceToken: BASE_USDC }

const optionsPayload = (options: unknown[]) => ({
  deposit_address: DEPOSIT_ADDRESS,
  required_min_received: "4900000",
  options,
})

const wireOption = (overrides: Record<string, unknown> = {}) => ({
  bridge: "across",
  amount_out: "4980000",
  min_received: "4950000",
  eligible: true,
  ...overrides,
})

const withEnvelope = (overrides: Record<string, unknown>) => ({
  ...optionsPayload([wireOption()]),
  ...overrides,
})

const withOption = (overrides: Record<string, unknown>) => optionsPayload([wireOption(overrides)])

describe("parseBridgeOptions", () => {
  it("returns the parsed envelope and options", () => {
    const parsed = parseBridgeOptions(
      optionsPayload([wireOption({ execution_duration_seconds: 30, gas_cost_usd: "0.42" })]),
      REQUEST,
    )
    expect(parsed.deposit_address).toBe(DEPOSIT_ADDRESS)
    expect(parsed.required_min_received).toBe("4900000")
    expect(parsed.options).toEqual([
      {
        bridge: "across",
        amount_out: "4980000",
        min_received: "4950000",
        eligible: true,
        execution_duration_seconds: 30,
        gas_cost_usd: "0.42",
      },
    ])
  })

  it.each([
    ["a non-object response", null, /is not an object/],
    ["an array response", [], /is not an object/],
    ["a malformed deposit address", withEnvelope({ deposit_address: "0x1234" }), /deposit address/],
    [
      "a missing options array",
      { deposit_address: DEPOSIT_ADDRESS, required_min_received: "1" },
      /missing its options array/,
    ],
    ["an empty bridge key", withOption({ bridge: "" }), /invalid bridge key/],
    ["a non-string bridge key", withOption({ bridge: 1 }), /invalid bridge key/],
    ["a non-positive amount_out", withOption({ amount_out: "0" }), /invalid amount_out/],
    ["a fractional min_received", withOption({ min_received: "4.95" }), /invalid min_received/],
    ["a non-boolean eligible flag", withOption({ eligible: "true" }), /non-boolean eligible/],
    [
      "a fractional duration",
      withOption({ execution_duration_seconds: 1.5 }),
      /invalid execution_duration_seconds/,
    ],
    [
      "a negative duration",
      withOption({ execution_duration_seconds: -1 }),
      /invalid execution_duration_seconds/,
    ],
    ["an unparseable gas_cost_usd", withOption({ gas_cost_usd: "free" }), /invalid gas_cost_usd/],
  ])("rejects %s", (_name, payload, message) => {
    expect(() => parseBridgeOptions(payload, REQUEST)).toThrow(message)
  })

  it.each(["0", "", "1.5", "-1", 4900000])(
    "rejects the required_min_received %o",
    (required_min_received) => {
      expect(() => parseBridgeOptions(withEnvelope({ required_min_received }), REQUEST)).toThrow(
        /invalid required_min_received/,
      )
    },
  )

  it("rejects duplicate bridge keys, including casing variants", () => {
    expect(() => parseBridgeOptions(optionsPayload([wireOption(), wireOption()]), REQUEST)).toThrow(
      /repeats the bridge key/,
    )
    expect(() =>
      parseBridgeOptions(
        optionsPayload([wireOption({ bridge: "Across" }), wireOption({ bridge: "across" })]),
        REQUEST,
      ),
    ).toThrow(/repeats the bridge key/)
  })

  it("keeps missing optional estimates undefined rather than zero", () => {
    const [parsed] = parseBridgeOptions(optionsPayload([wireOption()]), REQUEST).options
    expect(parsed.execution_duration_seconds).toBeUndefined()
    expect(parsed.gas_cost_usd).toBeUndefined()
  })

  it("treats an empty gas_cost_usd string as unknown", () => {
    const [parsed] = parseBridgeOptions(withOption({ gas_cost_usd: "" }), REQUEST).options
    expect(parsed.gas_cost_usd).toBeUndefined()
  })

  it("names the requested route in its errors", () => {
    expect(() => parseBridgeOptions(null, REQUEST)).toThrow(/8453:.*-> interwoven-1:uusdc/)
  })
})

const keys = (options: BridgeOption[]) => rankBridgeOptions(options).map(({ bridge }) => bridge)

describe("rankBridgeOptions", () => {
  it("puts every eligible route ahead of every ineligible one", () => {
    expect(
      keys([
        option({ bridge: "a", eligible: false, amount_out: "9000" }),
        option({ bridge: "b", amount_out: "1000" }),
      ]),
    ).toEqual(["b", "a"])
  })

  it("prefers the fastest route among those within 0.5% of the best net value", () => {
    expect(
      keys([
        option({ bridge: "slow", amount_out: "1000000", execution_duration_seconds: 1200 }),
        option({ bridge: "fast", amount_out: "996000", execution_duration_seconds: 4 }),
        option({ bridge: "mid", amount_out: "999000", execution_duration_seconds: 60 }),
      ]),
    ).toEqual(["fast", "mid", "slow"])
  })

  it("keeps a route paying materially more ahead of a faster one outside the tolerance", () => {
    expect(
      keys([
        option({ bridge: "rich", amount_out: "10000000", execution_duration_seconds: 1200 }),
        option({ bridge: "fast", amount_out: "9900000", execution_duration_seconds: 4 }),
      ]),
    ).toEqual(["rich", "fast"])
  })

  it("treats a gap under a cent as competitive even when it exceeds 0.5% of a small deposit", () => {
    // 0.5 USDC: $0.004 of extra gas is 0.8% of the output but not worth 9 minutes.
    expect(
      keys([
        option({ bridge: "slow", amount_out: "500000", execution_duration_seconds: 628 }),
        option({ bridge: "fast", amount_out: "496000", execution_duration_seconds: 106 }),
        option({ bridge: "far", amount_out: "480000", execution_duration_seconds: 3 }),
      ]),
    ).toEqual(["fast", "slow", "far"])
  })

  it("nets the quoted gas out of the output before comparing", () => {
    // 1.00 USDC out minus $0.05 gas ranks below 0.96 USDC with free gas, so output alone would have ordered these the other way.
    expect(
      keys([
        option({ bridge: "gassy", amount_out: "1000000", gas_cost_usd: "0.05" }),
        option({ bridge: "lean", amount_out: "960000", gas_cost_usd: "0" }),
      ]),
    ).toEqual(["lean", "gassy"])
  })

  it("never ranks a route without a gas estimate ahead of one with a known estimate", () => {
    expect(
      keys([
        option({
          bridge: "unpriced",
          amount_out: "1000000",
          execution_duration_seconds: 4,
          gas_cost_usd: undefined,
        }),
        option({
          bridge: "priced",
          amount_out: "990000",
          execution_duration_seconds: 600,
          gas_cost_usd: "0.02",
        }),
      ]),
    ).toEqual(["priced", "unpriced"])
  })

  it("sorts an unknown duration after every known one among competitive routes", () => {
    expect(
      keys([
        option({ bridge: "unknown" }),
        option({ bridge: "slow", execution_duration_seconds: 3000 }),
      ]),
    ).toEqual(["slow", "unknown"])
  })

  it("breaks a duration tie by the lower known gas cost", () => {
    // Same duration and the same net value (output minus gas), so only gas can decide;
    // the key order would put "alpha" first.
    expect(
      keys([
        option({
          bridge: "alpha",
          amount_out: "1001200",
          execution_duration_seconds: 30,
          gas_cost_usd: "0.0012",
        }),
        option({
          bridge: "zeta",
          amount_out: "1000900",
          execution_duration_seconds: 30,
          gas_cost_usd: "0.0009",
        }),
      ]),
    ).toEqual(["zeta", "alpha"])
  })

  it("falls back to the bridge key so the order is deterministic", () => {
    expect(keys([option({ bridge: "relay" }), option({ bridge: "across" })])).toEqual([
      "across",
      "relay",
    ])
  })

  it("does not mutate its input", () => {
    const input = [option({ bridge: "b" }), option({ bridge: "a" })]
    rankBridgeOptions(input)
    expect(input.map(({ bridge }) => bridge)).toEqual(["b", "a"])
  })
})

describe("percentDifference", () => {
  it("reports the signed percentage against the best value", () => {
    expect(percentDifference("1000000", "1000000")).toBe("0.00%")
    expect(percentDifference("999999", "1000000")).toBe("0.00%")
    expect(percentDifference("1010000", "1000000")).toBe("+1.00%")
    expect(percentDifference("990000", "1000000")).toBe("-1.00%")
    expect(percentDifference("nope", "1000000")).toBe("")
    expect(percentDifference(undefined, "1000000")).toBe("")
    expect(percentDifference("1", "0")).toBe("")
  })
})

const quotePayload = (overrides: Record<string, unknown> = {}) => ({
  provider: "lifi",
  src_chain_id: "8453",
  src_denom: BASE_USDC,
  dst_chain_id: "interwoven-1",
  dst_denom: "uusdc",
  amount: "5000000",
  wallet_address: RECIPIENT,
  deposit_address: DEPOSIT_ADDRESS,
  cursor: "v1.abc",
  amount_out: "4980000",
  min_received: "4950000",
  tool: "across",
  estimate: { execution_duration_seconds: 30, gas_cost_usd: "0.42" },
  approval: { token_address: BASE_USDC, spender_address: SPENDER, amount: "5000000" },
  transaction: {
    chain_id: "8453",
    from: SENDER,
    to: BRIDGE_ROUTER,
    value: "0x0",
    data: "0xdeadbeef",
    gas_limit: "250000",
  },
  ...overrides,
})

const withTransaction = (overrides: Record<string, unknown>) =>
  quotePayload({ transaction: { ...quotePayload().transaction, ...overrides } })

const withApproval = (overrides: Record<string, unknown> | null) =>
  quotePayload({
    approval: overrides === null ? null : { ...quotePayload().approval, ...overrides },
  })

describe("parseBridgeQuote", () => {
  it("returns the executable quote", () => {
    const quote = parseBridgeQuote(quotePayload(), QUOTE_REQUEST)
    expect(quote.provider).toBe("lifi")
    expect(quote.tool).toBe("across")
    expect(quote.cursor).toBe("v1.abc")
    expect(quote.transaction).toEqual({
      chain_id: "8453",
      from: SENDER,
      to: BRIDGE_ROUTER,
      value: "0",
      data: "0xdeadbeef",
      gas_limit: "250000",
    })
    expect(quote.approval).toEqual({
      token_address: BASE_USDC,
      spender_address: SPENDER,
      amount: "5000000",
    })
    expect(quote.estimate).toEqual({ execution_duration_seconds: 30, gas_cost_usd: "0.42" })
  })

  // Every field is bound to the retained request: a quote echoing a different
  // chain, denom, amount, recipient or sender would move real funds.
  it.each([
    ["a non-object response", "nope", /is not an object/],
    ["a provider other than lifi", quotePayload({ provider: "skip" }), /unexpected provider/],
    ["a tool that is not the selected bridge", quotePayload({ tool: "relay" }), /tool mismatch/],
    ["another src_chain_id", quotePayload({ src_chain_id: "42161" }), /src_chain_id mismatch/],
    ["another src_denom", quotePayload({ src_denom: "ethereum-native" }), /src_denom mismatch/],
    ["another dst_chain_id", quotePayload({ dst_chain_id: "yominet-1" }), /dst_chain_id mismatch/],
    ["another dst_denom", quotePayload({ dst_denom: "uinit" }), /dst_denom mismatch/],
    ["another amount", quotePayload({ amount: "4000000" }), /amount mismatch/],
    ["a numeric amount", quotePayload({ amount: 5000000 }), /amount mismatch/],
    [
      "another recipient",
      quotePayload({ wallet_address: "init1someoneelse" }),
      /wallet_address mismatch/,
    ],
    ["a malformed deposit address", quotePayload({ deposit_address: "0x00" }), /deposit address/],
    ["a missing cursor", quotePayload({ cursor: "" }), /missing the cursor/],
    ["a non-positive amount_out", quotePayload({ amount_out: "0" }), /invalid amount_out/],
    ["a malformed min_received", quotePayload({ min_received: "x" }), /invalid min_received/],
  ])("rejects %s", (_name, payload, message) => {
    expect(() => parseBridgeQuote(payload, QUOTE_REQUEST)).toThrow(message)
  })

  it("accepts the selected bridge in different casing", () => {
    expect(parseBridgeQuote(quotePayload({ tool: "Across" }), QUOTE_REQUEST).tool).toBe("Across")
  })

  it("compares EVM denoms case-insensitively", () => {
    const payload = quotePayload({ src_denom: BASE_USDC.toLowerCase() })
    expect(parseBridgeQuote(payload, QUOTE_REQUEST).src_denom).toBe(BASE_USDC.toLowerCase())
  })

  describe("transaction", () => {
    it.each([
      ["built for another chain", withTransaction({ chain_id: "1" }), /chain_id mismatch/],
      [
        "addressed from another sender",
        withTransaction({ from: "0x4444444444444444444444444444444444444444" }),
        /from mismatch/,
      ],
      ["with a malformed to address", withTransaction({ to: "not-an-address" }), /invalid to/],
      ["with non-hex calldata", withTransaction({ data: "zzzz" }), /non-hex calldata/],
      ["with odd-length calldata", withTransaction({ data: "0xabc" }), /non-hex calldata/],
      ["that is not an object", quotePayload({ transaction: null }), /malformed transaction/],
    ])("rejects a transaction %s", (_name, payload, message) => {
      expect(() => parseBridgeQuote(payload, QUOTE_REQUEST)).toThrow(message)
    })

    // A dropped protocol/messaging fee makes the bridge call revert; a fabricated
    // one overpays from the user's own balance.
    it.each(["", "-1", "0x", "1.5", 100])("rejects the value %o", (value) => {
      expect(() => parseBridgeQuote(withTransaction({ value }), QUOTE_REQUEST)).toThrow(
        /invalid value/,
      )
    })

    it.each(["250000.5", "0", "abc", 250000, "0x0"])("rejects the gas_limit %o", (gas_limit) => {
      expect(() => parseBridgeQuote(withTransaction({ gas_limit }), QUOTE_REQUEST)).toThrow(
        /invalid gas_limit/,
      )
    })

    it("accepts a numeric wire chain_id after normalization", () => {
      expect(
        parseBridgeQuote(withTransaction({ chain_id: 8453 }), QUOTE_REQUEST).transaction.chain_id,
      ).toBe("8453")
    })

    it("accepts the connected sender in either casing", () => {
      const upper = `0x${SENDER.slice(2).toUpperCase()}`
      expect(
        parseBridgeQuote(withTransaction({ from: upper }), {
          ...QUOTE_REQUEST,
          fromAddress: SENDER.toLowerCase(),
        }).transaction.from,
      ).toBe(upper)
    })

    it("accepts empty calldata", () => {
      expect(
        parseBridgeQuote(withTransaction({ data: "0x" }), QUOTE_REQUEST).transaction.data,
      ).toBe("0x")
    })

    // A nonzero fee has to survive the hex-to-decimal normalization intact.
    it("normalizes a hex value to a decimal string", () => {
      expect(
        parseBridgeQuote(withTransaction({ value: "0x2386f26fc10000" }), QUOTE_REQUEST).transaction
          .value,
      ).toBe("10000000000000000")
    })

    it("accepts a decimal value string unchanged", () => {
      expect(
        parseBridgeQuote(withTransaction({ value: "12345" }), QUOTE_REQUEST).transaction.value,
      ).toBe("12345")
    })

    it("normalizes a 0x-hex gas_limit (staging's wire form) to decimal", () => {
      const quote = parseBridgeQuote(withTransaction({ gas_limit: "0x11ab0c" }), QUOTE_REQUEST)
      expect(quote.transaction.gas_limit).toBe("1157900")
    })

    it("treats an absent gas_limit as unset", () => {
      const payload = withTransaction({})
      delete (payload.transaction as Record<string, unknown>).gas_limit
      expect(parseBridgeQuote(payload, QUOTE_REQUEST).transaction.gas_limit).toBeUndefined()
    })
  })

  describe("approval", () => {
    it.each([
      ["null for an ERC-20 source", withApproval(null), /missing the ERC-20 approval/],
      [
        "for another token",
        withApproval({ token_address: "0x0000000000000000000000000000000000000dEaD" }),
        /approval token_address mismatch/,
      ],
      [
        "with a zero spender",
        withApproval({ spender_address: "0x0000000000000000000000000000000000000000" }),
        /approval spender_address is invalid/,
      ],
      [
        "with a malformed spender",
        withApproval({ spender_address: "0xbeef" }),
        /approval spender_address is invalid/,
      ],
      ["with a non-positive amount", withApproval({ amount: "0" }), /approval amount is invalid/],
      ["that is not an object", quotePayload({ approval: "yes" }), /malformed approval/],
    ])("rejects an approval %s", (_name, payload, message) => {
      expect(() => parseBridgeQuote(payload, QUOTE_REQUEST)).toThrow(message)
    })

    it("allows a null approval for a native source", () => {
      const native = {
        ...QUOTE_REQUEST,
        srcDenom: "ethereum-native",
        sourceToken: "ethereum-native",
      }
      const payload = quotePayload({ approval: null, src_denom: "ethereum-native" })
      expect(parseBridgeQuote(payload, native).approval).toBeNull()
    })

    it("matches the approval token case-insensitively", () => {
      expect(
        parseBridgeQuote(withApproval({ token_address: BASE_USDC.toLowerCase() }), QUOTE_REQUEST)
          .approval?.token_address,
      ).toBe(BASE_USDC.toLowerCase())
    })
  })
})

describe("bridgeQuoteSignature", () => {
  const signatureOf = (overrides: Record<string, unknown> = {}) =>
    bridgeQuoteSignature(parseBridgeQuote(quotePayload(overrides), QUOTE_REQUEST))

  it("is stable across identical quotes", () => {
    expect(signatureOf()).toBe(signatureOf())
  })

  it("ignores address casing", () => {
    expect(signatureOf({ tool: "Across" })).toBe(signatureOf())
  })

  // LI.FI re-encodes calldata and re-estimates gas on every quote, so neither may force a second click.
  it("ignores re-encoded calldata and a new gas estimate", () => {
    for (const overrides of [{ data: "0xcafe" }, { gas_limit: "300000" }]) {
      expect(
        bridgeQuoteSignature(parseBridgeQuote(withTransaction(overrides), QUOTE_REQUEST)),
      ).toBe(signatureOf())
    }
  })

  it("changes when the contract or native value changes", () => {
    const base = signatureOf()
    for (const overrides of [
      { to: "0x5555555555555555555555555555555555555555" },
      { value: "0x1" },
    ]) {
      expect(
        bridgeQuoteSignature(parseBridgeQuote(withTransaction(overrides), QUOTE_REQUEST)),
      ).not.toBe(base)
    }
  })

  it("changes when the approval spender or amount changes", () => {
    const base = signatureOf()
    expect(
      bridgeQuoteSignature(
        parseBridgeQuote(
          withApproval({ spender_address: "0x6666666666666666666666666666666666666666" }),
          QUOTE_REQUEST,
        ),
      ),
    ).not.toBe(base)
    expect(
      bridgeQuoteSignature(parseBridgeQuote(withApproval({ amount: "9000000" }), QUOTE_REQUEST)),
    ).not.toBe(base)
  })

  it("changes when the promised output changes", () => {
    expect(signatureOf({ min_received: "4000000" })).not.toBe(signatureOf())
    expect(signatureOf({ amount_out: "4000000" })).not.toBe(signatureOf())
  })
})

describe("meetsRequiredMinimum", () => {
  it("compares against the greater of the two minimums", () => {
    expect(meetsRequiredMinimum({ min_received: "1000" }, "900", "1000")).toBe(true)
    expect(meetsRequiredMinimum({ min_received: "1000" }, "1001", "900")).toBe(false)
    expect(meetsRequiredMinimum({ min_received: "1000" }, "900", "1001")).toBe(false)
  })

  it("treats an exact match as sufficient", () => {
    expect(meetsRequiredMinimum({ min_received: "1000" }, "1000", "1000")).toBe(true)
  })

  it("compares as integers, not lexically", () => {
    expect(meetsRequiredMinimum({ min_received: "10000000" }, "9000000", "0")).toBe(true)
  })

  it("answers false for any unparseable input", () => {
    expect(meetsRequiredMinimum({ min_received: "" }, "1", "1")).toBe(false)
    expect(meetsRequiredMinimum({ min_received: "0" }, "0", "0")).toBe(false)
    expect(meetsRequiredMinimum({ min_received: "1000" }, "", "1")).toBe(false)
    expect(meetsRequiredMinimum({ min_received: "1000" }, "1", "1.5")).toBe(false)
  })
})

const EXPECTED = { srcChainId: "8453", srcTxHash: SRC_TX_HASH }

const statusPayload = (overrides: Record<string, unknown> = {}) => ({
  state: "bridge_pending",
  src_chain_id: 8453,
  src_tx_hash: SRC_TX_HASH,
  src_tx_link: "https://basescan.org/tx/1",
  deposit: null,
  ...overrides,
})

describe("parseBridgeStatus", () => {
  // The wire sends a JSON integer; `8453 !== "8453"` in JavaScript.
  it("normalizes the integer src_chain_id to a string before comparing", () => {
    const parsed = parseBridgeStatus(statusPayload(), EXPECTED)
    expect(parsed.src_chain_id).toBe("8453")
  })

  it("accepts a string src_chain_id too", () => {
    expect(parseBridgeStatus(statusPayload({ src_chain_id: "8453" }), EXPECTED).src_chain_id).toBe(
      "8453",
    )
  })

  it.each([
    ["for another source chain", statusPayload({ src_chain_id: 42161 }), /src_chain_id mismatch/],
    [
      "for another transaction",
      statusPayload({ src_tx_hash: `0x${"c".repeat(64)}` }),
      /src_tx_hash mismatch/,
    ],
    ["in an undocumented state", statusPayload({ state: "bridge_done" }), /unknown state/],
    ["with no state", statusPayload({ state: undefined }), /unknown state/],
    [
      "carrying a deposit outside deposit_indexed",
      statusPayload({ state: "bridge_pending", deposit: deposit() }),
      /carries a deposit in state bridge_pending/,
    ],
    [
      "reporting deposit_indexed without one",
      statusPayload({ state: "deposit_indexed" }),
      /deposit_indexed without a deposit/,
    ],
    ["with a malformed dst_tx_hash", statusPayload({ dst_tx_hash: "0xshort" }), /dst_tx_hash/],
    ["that is not an object", undefined, /is not an object/],
  ])("rejects a status %s", (_name, payload, message) => {
    expect(() => parseBridgeStatus(payload, EXPECTED)).toThrow(message)
  })

  it("compares the source hash case-insensitively", () => {
    const upper = `0x${SRC_TX_HASH.slice(2).toUpperCase()}`
    expect(parseBridgeStatus(statusPayload({ src_tx_hash: upper }), EXPECTED).src_tx_hash).toBe(
      upper,
    )
  })

  it("accepts every documented state", () => {
    for (const state of [
      "deposit_pending",
      "bridge_not_found",
      "bridge_pending",
      "bridge_refunding",
      "bridge_partial",
      "bridge_refunded",
      "bridge_refund_required",
      "bridge_failed",
    ]) {
      expect(parseBridgeStatus(statusPayload({ state }), EXPECTED).state).toBe(state)
    }
  })

  it("returns the nested deposit for deposit_indexed", () => {
    const parsed = parseBridgeStatus(
      statusPayload({ state: "deposit_indexed", deposit: deposit(), dst_tx_hash: DST_TX_HASH }),
      EXPECTED,
    )
    expect(parsed.deposit?.id).toBe("d1")
    expect(parsed.dst_tx_hash).toBe(DST_TX_HASH)
  })

  it("rejects a nested deposit missing an identity field", () => {
    const broken = deposit()
    delete (broken as unknown as Record<string, unknown>).deposit_address
    expect(() =>
      parseBridgeStatus(statusPayload({ state: "deposit_indexed", deposit: broken }), EXPECTED),
    ).toThrow(/deposit has an invalid deposit_address/)
  })

  it("treats an absent or empty dst_tx_hash as unknown", () => {
    expect(parseBridgeStatus(statusPayload(), EXPECTED).dst_tx_hash).toBeUndefined()
    expect(
      parseBridgeStatus(statusPayload({ dst_tx_hash: "" }), EXPECTED).dst_tx_hash,
    ).toBeUndefined()
  })

  it("degrades a missing explorer link instead of throwing", () => {
    expect(parseBridgeStatus(statusPayload({ src_tx_link: undefined }), EXPECTED).src_tx_link).toBe(
      "",
    )
  })

  it("keeps the reported tool as diagnostic context", () => {
    expect(parseBridgeStatus(statusPayload({ bridge: "across" }), EXPECTED).bridge).toBe("across")
  })
})

describe("classifyBridgeStatusError", () => {
  // This endpoint answers `{ error, message }` instead of the API-wide `{ message }`.
  it("throws a coded conflict for a coded body", async () => {
    await expect(
      classifyBridgeStatusError(
        httpError(502, { error: "upstream_conflict", message: "tool mismatch" }),
      ),
    ).rejects.toMatchObject({ code: "upstream_conflict", message: "tool mismatch" })
  })

  it.each(BRIDGE_STATUS_ERROR_CODES)("keeps the documented code %s", async (code) => {
    await expect(
      classifyBridgeStatusError(httpError(500, { error: code, message: "x" })),
    ).rejects.toMatchObject({ code })
  })

  // A rate limit is classified by its code like any other coded failure; the
  // screen's own cadence is the only backoff (see bridgeStatusPollInterval).
  it("classifies a 429 through its coded body", async () => {
    await expect(
      classifyBridgeStatusError(httpError(429, { error: "rate_limited", message: "slow down" })),
    ).rejects.toMatchObject({ code: "rate_limited", message: "slow down" })
  })

  it("falls back to the code when the body carries no message", async () => {
    await expect(
      classifyBridgeStatusError(httpError(502, { error: "upstream_conflict" })),
    ).rejects.toMatchObject({ message: "upstream_conflict" })
  })

  it("normalizes an uncoded HTTP failure", async () => {
    await expect(classifyBridgeStatusError(httpError(500, { message: "boom" }))).rejects.toThrow(
      "boom",
    )
    await expect(
      classifyBridgeStatusError(httpError(500, { message: "boom" })),
    ).rejects.not.toBeInstanceOf(BridgeStatusConflictError)
  })

  it("normalizes a non-JSON body and a plain failure", async () => {
    await expect(classifyBridgeStatusError(httpError(503))).rejects.toThrow()
    await expect(classifyBridgeStatusError(new Error("offline"))).rejects.toThrow("offline")
  })
})

describe("bridgeStatusPollInterval", () => {
  it("polls fast while the user is watching and backs off once idle", () => {
    expect(bridgeStatusPollInterval("bridge_pending", null, 0)).toBe(3000)
    expect(bridgeStatusPollInterval("bridge_pending", null, 6 * 60_000)).toBe(15_000)
  })

  it("keeps polling through the in-flight states", () => {
    for (const state of [
      "bridge_not_found",
      "bridge_pending",
      "bridge_refunding",
      "deposit_pending",
    ] as const) {
      expect(bridgeStatusPollInterval(state, null, 0)).toBe(3000)
    }
  })

  it("keeps polling before the first response", () => {
    expect(bridgeStatusPollInterval(undefined, null, 0)).toBe(3000)
  })

  it("stops on a deterministic invalid_request as well as upstream_conflict", () => {
    for (const code of ["upstream_conflict", "invalid_request"] as const) {
      const error = new BridgeStatusConflictError(code, "rejected")
      expect(bridgeStatusPollInterval("bridge_pending", error, 0)).toBe(false)
    }
  })

  // Neither a transient upstream nor a rate limit is a verdict on the transfer.
  it("keeps polling through the transient coded failures", () => {
    for (const code of ["upstream_unavailable", "rate_limited", "internal_error"] as const) {
      const error = new BridgeStatusConflictError(code, "later")
      expect(bridgeStatusPollInterval("bridge_pending", error, 0)).toBe(3000)
    }
  })

  it("stops after the handoff and on every terminal provider outcome", () => {
    for (const state of [
      "deposit_indexed",
      "bridge_partial",
      "bridge_refunded",
      "bridge_refund_required",
      "bridge_failed",
    ] as const) {
      expect(bridgeStatusPollInterval(state, null, 0)).toBe(false)
    }
  })
})

describe("createBridgeOptionsQueryOptions", () => {
  it("posts the request identity to the relative options path", async () => {
    const { api, calls } = stubApi(optionsPayload([wireOption()]))
    const { queryFn } = createBridgeOptionsQueryOptions(api, REQUEST, true)
    if (typeof queryFn !== "function") throw new Error("queryFn must be a function")
    await queryFn({} as unknown as Parameters<typeof queryFn>[0])
    expect(calls[0].url).toBe("v1/bridges/options")
    expect(calls[0].options?.json).toEqual({
      src_chain_id: "8453",
      src_denom: BASE_USDC,
      dst_chain_id: "interwoven-1",
      dst_denom: "uusdc",
      amount: "5000000",
      from_address: SENDER,
      wallet_address: RECIPIENT,
    })
  })

  it("routes the response through the boundary parser", async () => {
    const { api } = stubApi(optionsPayload([wireOption({ min_received: "oops" })]))
    const { queryFn } = createBridgeOptionsQueryOptions(api, REQUEST, true)
    if (typeof queryFn !== "function") throw new Error("queryFn must be a function")
    await expect(queryFn({} as unknown as Parameters<typeof queryFn>[0])).rejects.toThrow(
      /invalid min_received/,
    )
  })

  it("goes stale after 10 s, keeps the previous list, and never polls in the background", () => {
    const { api } = stubApi(null)
    const options = createBridgeOptionsQueryOptions(api, REQUEST, true)
    expect(options.staleTime).toBe(10_000)
    expect(options.refetchInterval).toBeUndefined()
    expect(options.refetchOnWindowFocus).toBe(false)
    expect(options.placeholderData).toBeTypeOf("function")
  })

  it("keys a changed sender or recipient separately", () => {
    const { api } = stubApi(null)
    const base = createBridgeOptionsQueryOptions(api, REQUEST, true).queryKey
    expect(
      createBridgeOptionsQueryOptions(api, { ...REQUEST, fromAddress: SPENDER }, true).queryKey,
    ).not.toEqual(base)
    expect(
      createBridgeOptionsQueryOptions(api, { ...REQUEST, walletAddress: "init1other" }, true)
        .queryKey,
    ).not.toEqual(base)
  })
})

describe("createBridgeQuoteQueryOptions", () => {
  it("includes the selected bridge in the request and the cache key", async () => {
    const { api, calls } = stubApi(quotePayload())
    const options = createBridgeQuoteQueryOptions(api, QUOTE_REQUEST, true)
    const { queryFn } = options
    if (typeof queryFn !== "function") throw new Error("queryFn must be a function")
    await queryFn({} as unknown as Parameters<typeof queryFn>[0])
    expect(calls[0].url).toBe("v1/bridges/quote")
    expect(calls[0].options?.json).toMatchObject({ bridge: "across" })
    expect(options.queryKey).toContain("across")
  })

  it("never keeps previous data", () => {
    const { api } = stubApi(null)
    expect(createBridgeQuoteQueryOptions(api, QUOTE_REQUEST, true).placeholderData).toBeUndefined()
  })

  it("routes the response through the boundary parser", async () => {
    const { api } = stubApi(quotePayload({ tool: "relay" }))
    const { queryFn } = createBridgeQuoteQueryOptions(api, QUOTE_REQUEST, true)
    if (typeof queryFn !== "function") throw new Error("queryFn must be a function")
    await expect(queryFn({} as unknown as Parameters<typeof queryFn>[0])).rejects.toThrow(
      /tool mismatch/,
    )
  })
})

describe("createBridgeStatusQueryOptions", () => {
  const PARAMS = {
    srcChainId: "8453",
    srcTxHash: SRC_TX_HASH,
    depositAddress: DEPOSIT_ADDRESS,
  }

  // The endpoint answers 502 upstream_conflict for a missing or mismatched hinted tool, including for not-found results.
  it("omits the bridge hint from the request", async () => {
    const { api, calls } = stubApi(statusPayload())
    const { queryFn } = createBridgeStatusQueryOptions(api, PARAMS, true, Date.now())
    if (typeof queryFn !== "function") throw new Error("queryFn must be a function")
    await queryFn({} as unknown as Parameters<typeof queryFn>[0])
    expect(calls[0].url).toBe("v1/bridges/status")
    expect(calls[0].options?.searchParams).toEqual({
      src_chain_id: "8453",
      src_tx_hash: SRC_TX_HASH,
      deposit_address: DEPOSIT_ADDRESS,
    })
    expect(calls[0].options?.searchParams).not.toHaveProperty("bridge")
  })

  it("classifies a coded failure instead of normalizing it away", async () => {
    const { api } = stubApi(httpError(502, { error: "upstream_conflict", message: "m" }))
    const { queryFn } = createBridgeStatusQueryOptions(api, PARAMS, true, Date.now())
    if (typeof queryFn !== "function") throw new Error("queryFn must be a function")
    await expect(queryFn({} as unknown as Parameters<typeof queryFn>[0])).rejects.toBeInstanceOf(
      BridgeStatusConflictError,
    )
  })

  it("never caches and never retries in place", () => {
    const { api } = stubApi(null)
    const options = createBridgeStatusQueryOptions(api, PARAMS, true, Date.now())
    expect(options.staleTime).toBe(0)
    expect(options.retry).toBe(false)
  })

  it("drives its interval from the observed state and error", () => {
    const { api } = stubApi(null)
    const { refetchInterval } = createBridgeStatusQueryOptions(api, PARAMS, true, Date.now())
    if (typeof refetchInterval !== "function") throw new Error("refetchInterval must be a function")
    const call = (data: unknown, error: Error | null) =>
      refetchInterval({ state: { data, error } } as unknown as Parameters<
        typeof refetchInterval
      >[0])
    expect(call({ state: "bridge_pending" }, null)).toBe(3000)
    expect(call({ state: "deposit_indexed" }, null)).toBe(false)
    expect(call(undefined, new BridgeStatusConflictError("upstream_conflict", "m"))).toBe(false)
  })
})
