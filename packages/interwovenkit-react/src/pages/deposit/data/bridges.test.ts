import BigNumber from "bignumber.js"
import ky from "ky"
import { describe, expect, it } from "vitest"
import { QueryClient } from "@tanstack/react-query"
import {
  bridgeQuoteSignature,
  BridgeStatusError,
  bridgeStatusPollInterval,
  classifyBridgeStatusError,
  createBridgeOptionsQueryOptions,
  createBridgeQuoteQueryOptions,
  createBridgeStatusQueryOptions,
  isBridgeQuoteMateriallyChanged,
  parseBridgeOptions,
  parseBridgeQuote,
  parseBridgeStatus,
  percentDifference,
  rankBridgeOptions,
  tagBridgeOptions,
} from "./bridges"
import { ParseError } from "./parse"
import {
  deposit,
  DEPOSIT_ADDRESS,
  DST_TX_HASH,
  httpError,
  RECIPIENT,
  runQueryFn,
  SRC_TX_HASH,
  stubApi,
} from "./testing"
import type { BridgeOption, BridgeRequestIdentity } from "./types"

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const SPENDER = "0x1111111111111111111111111111111111111111"
const BRIDGE_ROUTER = "0x2222222222222222222222222222222222222222"
const SENDER = "0x33333333333333333333333333333333333333Ab"
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

const REQUEST: BridgeRequestIdentity = {
  srcChainId: "8453",
  srcDenom: BASE_USDC,
  dstChainId: "interwoven-1",
  dstDenom: "uusdc",
  amount: "5000000",
  fromAddress: SENDER,
  walletAddress: RECIPIENT,
}

const QUOTE_REQUEST = { ...REQUEST, bridge: "across", depositAddress: DEPOSIT_ADDRESS }

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
      optionsPayload([
        wireOption({ execution_duration_seconds: 30, gas_cost_usd: "0.42", fee_cost_usd: "1.65" }),
      ]),
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
        fee_cost_usd: "1.65",
      },
    ])
  })

  it.each([
    ["a non-object response", null, /is not an object/],
    ["an array response", [], /is not an object/],
    [
      "a malformed deposit address",
      withEnvelope({ deposit_address: "0x1234" }),
      /invalid deposit_address/,
    ],
    [
      "a zero deposit address",
      withEnvelope({ deposit_address: ZERO_ADDRESS }),
      /invalid deposit_address/,
    ],
    [
      "a missing options array",
      { deposit_address: DEPOSIT_ADDRESS, required_min_received: "1" },
      /invalid options/,
    ],
    ["a null option", optionsPayload([null]), /option 0 is not an object/],
    ["an empty bridge key", withOption({ bridge: "" }), /invalid bridge/],
    ["a non-string bridge key", withOption({ bridge: 1 }), /invalid bridge/],
    [
      "bridge keys differing only in casing",
      optionsPayload([wireOption({ bridge: "Across" }), wireOption({ bridge: "across" })]),
      /repeats the bridge key/,
    ],
    ["a non-positive amount_out", withOption({ amount_out: "0" }), /invalid amount_out/],
    ["a fractional min_received", withOption({ min_received: "4.95" }), /invalid min_received/],
    ["a non-boolean eligible flag", withOption({ eligible: "true" }), /invalid eligible/],
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
    ["an unparseable fee_cost_usd", withOption({ fee_cost_usd: "free" }), /invalid fee_cost_usd/],
  ])("rejects %s", (_name, payload, message) => {
    expect(() => parseBridgeOptions(payload)).toThrow(message)
  })

  it.each(["0", "", "1.5", "-1", 4900000])(
    "rejects the required_min_received %o",
    (required_min_received) => {
      expect(() => parseBridgeOptions(withEnvelope({ required_min_received }))).toThrow(
        /invalid required_min_received/,
      )
    },
  )

  it.each<[string, Record<string, unknown>]>([
    ["absent", {}],
    ["null", { execution_duration_seconds: null, gas_cost_usd: null }],
    ["an empty gas cost", { gas_cost_usd: "" }],
  ])("keeps %s estimates unknown rather than zero", (_name, overrides) => {
    const [parsed] = parseBridgeOptions(withOption(overrides)).options
    expect(parsed.execution_duration_seconds).toBeUndefined()
    expect(parsed.gas_cost_usd).toBeUndefined()
  })
})

const usdc = (amount: string) => BigNumber(amount).shiftedBy(6).toFixed()

const option = (overrides: Partial<BridgeOption> & { bridge: string }): BridgeOption => ({
  amount_out: "1000",
  min_received: "1000",
  eligible: true,
  gas_cost_usd: "0",
  fee_cost_usd: "0",
  ...overrides,
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

  // Staging, 10 USDC from Arbitrum, 2026-09-29.
  it("picks the 10 s route over an 18 min one that delivers 10 cents more", () => {
    expect(
      keys([
        option({
          bridge: "polymerStandard",
          amount_out: "9975000",
          execution_duration_seconds: 1080,
        }),
        option({ bridge: "polymer", amount_out: "9873853", execution_duration_seconds: 10 }),
        option({ bridge: "across", amount_out: "9748551", execution_duration_seconds: 10 }),
        option({ bridge: "relaydepository", amount_out: "9626499", execution_duration_seconds: 4 }),
      ]),
    ).toEqual(["polymer", "across", "relaydepository", "polymerStandard"])
  })

  // Staging, about 1,000 USDC: bridge times within seconds of each other.
  it("never trades a dollar for a second", () => {
    expect(
      keys([
        option({ bridge: "mayan", amount_out: usdc("996.021343"), execution_duration_seconds: 3 }),
        option({ bridge: "relay", amount_out: usdc("997.194067"), execution_duration_seconds: 4 }),
        option({ bridge: "polymer", amount_out: usdc("997.1991"), execution_duration_seconds: 10 }),
      ]),
    ).toEqual(["polymer", "relay", "mayan"])
  })

  it.each([
    ["twenty minutes saved beats ten cents", 1210, usdc("99.9"), "fast"],
    ["a dollar beats two minutes saved", 130, usdc("99"), "slow"],
  ])("%s", (_, slowSeconds, fastAmount, first) => {
    const [top] = keys([
      option({ bridge: "slow", amount_out: usdc("100"), execution_duration_seconds: slowSeconds }),
      option({ bridge: "fast", amount_out: fastAmount, execution_duration_seconds: 10 }),
    ])
    expect(top).toBe(first)
  })

  it("nets gas and on-top fees out of the output before comparing", () => {
    expect(
      keys([
        option({
          bridge: "gassy",
          amount_out: usdc("100"),
          execution_duration_seconds: 10,
          gas_cost_usd: "2",
        }),
        option({
          bridge: "feed",
          amount_out: usdc("100"),
          execution_duration_seconds: 10,
          fee_cost_usd: "1.5",
        }),
        option({ bridge: "lean", amount_out: usdc("99"), execution_duration_seconds: 10 }),
      ]),
    ).toEqual(["lean", "feed", "gassy"])
  })

  it("ranks a route of unknown cost after every priced one, and by amount and time among itself", () => {
    const unpriced = { fee_cost_usd: undefined }
    expect(
      keys([
        option({
          bridge: "unpricedRich",
          amount_out: usdc("200"),
          execution_duration_seconds: 10,
          ...unpriced,
        }),
        option({ bridge: "priced", amount_out: usdc("100"), execution_duration_seconds: 10 }),
        option({
          bridge: "unpricedPoor",
          amount_out: usdc("150"),
          execution_duration_seconds: 10,
          ...unpriced,
        }),
      ]),
    ).toEqual(["priced", "unpricedRich", "unpricedPoor"])
  })

  it("counts an unknown time as the slowest known one", () => {
    expect(
      keys([
        option({ bridge: "unknown", amount_out: usdc("100.1") }),
        option({ bridge: "slow", amount_out: usdc("100"), execution_duration_seconds: 1200 }),
        option({ bridge: "fast", amount_out: usdc("99.9"), execution_duration_seconds: 10 }),
      ]),
    ).toEqual(["fast", "unknown", "slow"])
  })
})

describe("tagBridgeOptions", () => {
  const tags = (options: BridgeOption[]) => tagBridgeOptions(rankBridgeOptions(options))

  it("marks the fastest and the cheapest when neither is Best", () => {
    expect(
      tags([
        option({ bridge: "cheap", amount_out: usdc("100.5"), execution_duration_seconds: 1200 }),
        option({ bridge: "balanced", amount_out: usdc("100.4"), execution_duration_seconds: 90 }),
        option({ bridge: "quick", amount_out: usdc("99"), execution_duration_seconds: 3 }),
        option({
          bridge: "richer",
          amount_out: usdc("900"),
          eligible: false,
          execution_duration_seconds: 1,
        }),
      ]),
    ).toEqual({ best: "balanced", fastest: "quick", cheapest: "cheap" })
  })

  it("tags Fastest only when it saves at least a minute over Best", () => {
    const withQuick = (seconds: number) =>
      tags([
        option({ bridge: "balanced", amount_out: usdc("100"), execution_duration_seconds: 70 }),
        option({ bridge: "quick", amount_out: usdc("90"), execution_duration_seconds: seconds }),
      ]).fastest
    expect(withQuick(10)).toBe("quick")
    expect(withQuick(11)).toBeUndefined()
  })

  it("leaves a tag off when the Best route already wins it", () => {
    expect(
      tags([
        option({ bridge: "both", amount_out: usdc("100"), execution_duration_seconds: 5 }),
        option({ bridge: "other", amount_out: usdc("99"), execution_duration_seconds: 60 }),
      ]),
    ).toEqual({ best: "both", fastest: undefined, cheapest: undefined })
  })
})

describe("percentDifference", () => {
  it.each([
    ["1010000", "+1.00%"],
    ["990000", "-1.00%"],
    ["1000100", "+0.01%"],
    ["1000000", ""],
    ["1000099", ""],
    ["nope", ""],
    [undefined, ""],
  ])("reports %s against 1000000 as %j", (value, expected) => {
    expect(percentDifference(value, "1000000")).toBe(expected)
  })

  it("has no reference without a positive best value", () => {
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

const OTHER_ADDRESS = "0x7777777777777777777777777777777777777777"

describe("parseBridgeQuote", () => {
  const parsed = parseBridgeQuote(quotePayload(), QUOTE_REQUEST)

  it("returns the executable quote without the request's echoes", () => {
    expect(parsed).toEqual({
      deposit_address: DEPOSIT_ADDRESS,
      amount_out: "4980000",
      min_received: "4950000",
      tool: "across",
      estimate: { execution_duration_seconds: 30, gas_cost_usd: "0.42" },
      approval: { token_address: BASE_USDC, spender_address: SPENDER, amount: "5000000" },
      transaction: {
        chain_id: "8453",
        to: BRIDGE_ROUTER,
        value: "0",
        data: "0xdeadbeef",
        gas_limit: "250000",
      },
    })
  })

  it.each([
    ["a non-object response", "nope", /is not an object/],
    ["a provider other than lifi", quotePayload({ provider: "skip" }), /provider skip is not lifi/],
    ["a tool that is not the selected bridge", quotePayload({ tool: "relay" }), /tool relay/],
    ["another src_chain_id", quotePayload({ src_chain_id: "42161" }), /src_chain_id 42161/],
    ["another src_denom", quotePayload({ src_denom: "ethereum-native" }), /src_denom/],
    ["another dst_chain_id", quotePayload({ dst_chain_id: "yominet-1" }), /dst_chain_id/],
    ["another dst_denom", quotePayload({ dst_denom: "uinit" }), /dst_denom/],
    ["another amount", quotePayload({ amount: "4000000" }), /response amount 4000000/],
    ["a numeric amount", quotePayload({ amount: 5000000 }), /response amount 5000000 is not/],
    ["another recipient", quotePayload({ wallet_address: "init1someoneelse" }), /wallet_address/],
    [
      "a malformed deposit address",
      quotePayload({ deposit_address: "0x00" }),
      /invalid deposit_address/,
    ],
    [
      "a zero deposit address",
      quotePayload({ deposit_address: ZERO_ADDRESS }),
      /invalid deposit_address/,
    ],
    [
      "a deposit address other than the options'",
      quotePayload({ deposit_address: OTHER_ADDRESS }),
      /deposit_address 0x7+ is not/,
    ],
    ["a non-positive amount_out", quotePayload({ amount_out: "0" }), /invalid amount_out/],
    ["a malformed min_received", quotePayload({ min_received: "x" }), /invalid min_received/],
    [
      "an invalid estimated duration",
      quotePayload({ estimate: { execution_duration_seconds: -1 } }),
      /estimate has an invalid execution_duration_seconds/,
    ],
  ])("rejects %s", (_name, payload, message) => {
    expect(() => parseBridgeQuote(payload, QUOTE_REQUEST)).toThrow(message)
  })

  it.each([
    ["the tool", quotePayload({ tool: "Across" })],
    ["the source denom", quotePayload({ src_denom: BASE_USDC.toLowerCase() })],
    ["the deposit address", quotePayload({ deposit_address: DEPOSIT_ADDRESS.toLowerCase() })],
    ["the approval token", withApproval({ token_address: BASE_USDC.toLowerCase() })],
    ["the sender", withTransaction({ from: SENDER.toLowerCase() })],
    ["numeric chain ids", { ...withTransaction({ chain_id: 8453 }), src_chain_id: 8453 }],
  ])("binds %s loosely and returns the request's own copy", (_name, payload) => {
    expect(parseBridgeQuote(payload, QUOTE_REQUEST)).toEqual(parsed)
  })

  it.each([undefined, null, "fast"])("treats an estimate of %o as unknown", (estimate) => {
    expect(parseBridgeQuote(quotePayload({ estimate }), QUOTE_REQUEST).estimate).toEqual({
      execution_duration_seconds: undefined,
      gas_cost_usd: undefined,
    })
  })

  describe("transaction", () => {
    it.each([
      ["built for another chain", withTransaction({ chain_id: "1" }), /chain_id 1 is not 8453/],
      [
        "addressed from another sender",
        withTransaction({ from: "0x4444444444444444444444444444444444444444" }),
        /transaction from/,
      ],
      ["with a malformed to address", withTransaction({ to: "not-an-address" }), /invalid to/],
      ["sent to the zero address", withTransaction({ to: ZERO_ADDRESS }), /invalid to/],
      ["with non-hex calldata", withTransaction({ data: "zzzz" }), /invalid data/],
      [
        "that is not an object",
        quotePayload({ transaction: null }),
        /transaction is not an object/,
      ],
    ])("rejects a transaction %s", (_name, payload, message) => {
      expect(() => parseBridgeQuote(payload, QUOTE_REQUEST)).toThrow(message)
    })

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

    it("accepts empty calldata", () => {
      expect(
        parseBridgeQuote(withTransaction({ data: "0x" }), QUOTE_REQUEST).transaction.data,
      ).toBe("0x")
    })

    it.each([
      ["0x2386f26fc10000", "10000000000000000"],
      ["12345", "12345"],
    ])("normalizes the value %s to %s", (value, expected) => {
      expect(parseBridgeQuote(withTransaction({ value }), QUOTE_REQUEST).transaction.value).toBe(
        expected,
      )
    })

    it.each([
      ["0x11ab0c", "1157900"],
      [undefined, undefined],
      ["", undefined],
      [null, undefined],
    ])("normalizes the gas_limit %o to %o", (gas_limit, expected) => {
      expect(
        parseBridgeQuote(withTransaction({ gas_limit }), QUOTE_REQUEST).transaction.gas_limit,
      ).toBe(expected)
    })
  })

  it.each([
    ["that is null", withApproval(null), /approval is missing/],
    [
      "for another token",
      withApproval({ token_address: "0x0000000000000000000000000000000000000dEaD" }),
      /approval token_address/,
    ],
    [
      "with a zero spender",
      withApproval({ spender_address: ZERO_ADDRESS }),
      /approval has an invalid spender_address/,
    ],
    [
      "with a malformed spender",
      withApproval({ spender_address: "0xbeef" }),
      /approval has an invalid spender_address/,
    ],
    ["below the transfer amount", withApproval({ amount: "1" }), /approval amount 1 is not/],
    ["above the transfer amount", withApproval({ amount: "5000001" }), /approval amount 5000001/],
  ])("rejects an approval %s", (_name, payload, message) => {
    expect(() => parseBridgeQuote(payload, QUOTE_REQUEST)).toThrow(message)
  })
})

describe("bridgeQuoteSignature", () => {
  const signatureOf = (payload: ReturnType<typeof quotePayload>, request = QUOTE_REQUEST) =>
    bridgeQuoteSignature(parseBridgeQuote(payload, request))
  const reviewed = signatureOf(quotePayload())

  it.each([
    ["re-encoded calldata", withTransaction({ data: "0xcafe" })],
    ["a new gas estimate", withTransaction({ gas_limit: "300000" })],
  ])("ignores %s", (_name, payload) => {
    expect(signatureOf(payload)).toBe(reviewed)
  })

  it.each([
    ["contract", withTransaction({ to: "0x5555555555555555555555555555555555555555" })],
    ["native value", withTransaction({ value: "0x1" })],
    [
      "approval spender",
      withApproval({ spender_address: "0x6666666666666666666666666666666666666666" }),
    ],
    ["min_received", quotePayload({ min_received: "4000000" })],
    ["amount_out", quotePayload({ amount_out: "4000000" })],
  ])("changes with the %s", (_name, payload) => {
    expect(signatureOf(payload)).not.toBe(reviewed)
  })

  it("changes with a reissued deposit address", () => {
    expect(
      signatureOf(quotePayload({ deposit_address: OTHER_ADDRESS }), {
        ...QUOTE_REQUEST,
        depositAddress: OTHER_ADDRESS,
      }),
    ).not.toBe(reviewed)
  })
})

describe("isBridgeQuoteMateriallyChanged", () => {
  const payload = (overrides: Record<string, unknown> = {}, transaction = {}) =>
    quotePayload({
      transaction: { ...quotePayload().transaction, value: "1000000", ...transaction },
      ...overrides,
    })
  const parse = (quote: ReturnType<typeof quotePayload>) => parseBridgeQuote(quote, QUOTE_REQUEST)
  const reviewed = parse(payload())

  it.each([
    ["re-encoded calldata", payload({}, { data: "0xcafe" })],
    ["a higher amount", payload({ amount_out: "4990000", min_received: "4960000" })],
    ["a guaranteed amount 0.1% lower", payload({ min_received: "4945050" })],
    ["a native fee up to 1% higher", payload({}, { value: "1010000" })],
    ["a lower native fee", payload({}, { value: "900000" })],
  ])("signs %s without another review", (_name, fresh) => {
    expect(isBridgeQuoteMateriallyChanged(reviewed, parse(fresh))).toBe(false)
  })

  it.each([
    ["a guaranteed amount more than 0.1% lower", parse(payload({ min_received: "4945049" }))],
    ["a native fee more than 1% higher", parse(payload({}, { value: "1010001" }))],
    ["another contract", parse(payload({}, { to: OTHER_ADDRESS }))],
    [
      "another approval spender",
      parse(payload({ approval: { ...quotePayload().approval, spender_address: OTHER_ADDRESS } })),
    ],
    ["another bridge", { ...reviewed, tool: "stargate" }],
    ["another deposit address", { ...reviewed, deposit_address: OTHER_ADDRESS }],
  ])("asks for review on %s", (_name, fresh) => {
    expect(isBridgeQuoteMateriallyChanged(reviewed, fresh)).toBe(true)
  })

  it("asks for review on a drop just over 0.1% that rounding would let through", () => {
    const base = { ...reviewed, min_received: "100000001" }
    expect(isBridgeQuoteMateriallyChanged(base, { ...base, min_received: "99900000" })).toBe(true)
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
  it("treats an unavailable fallback as a failed read, not a pending observation", () => {
    expect(() => parseBridgeStatus(statusPayload({ status_unavailable: true }), EXPECTED)).toThrow(
      BridgeStatusError,
    )
    expect(parseBridgeStatus(statusPayload({ status_unavailable: false }), EXPECTED).state).toBe(
      "bridge_pending",
    )
  })

  it.each([
    { status_unavailable: "true" },
    { status_unavailable: null },
    { status_unavailable: true, src_tx_hash: DST_TX_HASH },
    { status_unavailable: true, state: "bridge_refunded" },
    { status_unavailable: true, deposit: deposit() },
    { status_unavailable: true, dst_tx_hash: DST_TX_HASH },
  ])("rejects malformed or conflicting fallback evidence: %o", (overrides) => {
    expect(() => parseBridgeStatus(statusPayload(overrides), EXPECTED)).toThrow(ParseError)
  })
  it.each([
    ["a numeric chain id", statusPayload({ src_chain_id: 8453 })],
    ["a string chain id", statusPayload({ src_chain_id: "8453" })],
    [
      "the source hash in another casing",
      statusPayload({ src_tx_hash: SRC_TX_HASH.toUpperCase() }),
    ],
  ])("binds %s to the request", (_name, payload) => {
    expect(parseBridgeStatus(payload, EXPECTED).state).toBe("bridge_pending")
  })

  it.each([
    ["for another source chain", statusPayload({ src_chain_id: 42161 }), /src_chain_id 42161/],
    [
      "for another transaction",
      statusPayload({ src_tx_hash: `0x${"c".repeat(64)}` }),
      /src_tx_hash 0xc+ is not/,
    ],
    ["in an undocumented state", statusPayload({ state: "bridge_done" }), /invalid state/],
    ["with no state", statusPayload({ state: undefined }), /invalid state/],
    [
      "reporting deposit_indexed without a deposit",
      statusPayload({ state: "deposit_indexed" }),
      /deposit is not an object/,
    ],
    ["with a malformed dst_tx_hash", statusPayload({ dst_tx_hash: "0xshort" }), /dst_tx_hash/],
    ["that is not an object", undefined, /is not an object/],
  ])("rejects a status %s", (_name, payload, message) => {
    expect(() => parseBridgeStatus(payload, EXPECTED)).toThrow(message)
  })

  it("returns the nested deposit only for deposit_indexed", () => {
    const parsed = parseBridgeStatus(
      statusPayload({ state: "deposit_indexed", deposit: deposit(), dst_tx_hash: DST_TX_HASH }),
      EXPECTED,
    )
    expect(parsed.deposit?.id).toBe("d1")
    expect(parsed.dst_tx_hash).toBe(DST_TX_HASH)
    expect(parseBridgeStatus(statusPayload({ deposit: deposit() }), EXPECTED).deposit).toBeNull()
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
})

describe("classifyBridgeStatusError", () => {
  it.each([
    [502, { error: "upstream_conflict", message: "tool mismatch" }, "tool mismatch"],
    [500, { error: "some_new_code" }, "some_new_code"],
  ])("keeps the code of a coded %i", async (status, body, message) => {
    const error = await classifyBridgeStatusError(httpError(status, body)).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BridgeStatusError)
    expect(error).toMatchObject({ code: body.error, message })
  })

  it("sanitizes gateway failures and normalizes non-HTTP failures", async () => {
    const uncoded = await classifyBridgeStatusError(httpError(500, { message: "boom" })).catch(
      (e: unknown) => e,
    )
    expect(uncoded).toBeInstanceOf(BridgeStatusError)
    expect(uncoded).toMatchObject({ code: "upstream_unavailable" })
    expect((uncoded as Error).message).not.toContain("boom")
    await expect(classifyBridgeStatusError(httpError(503))).rejects.toThrow()
    await expect(classifyBridgeStatusError(new Error("offline"))).rejects.toThrow("offline")
  })
})

describe("bridgeStatusPollInterval", () => {
  const coded = (code: string) => new BridgeStatusError(code, "m")

  it.each<[string, Parameters<typeof bridgeStatusPollInterval>, number | false]>([
    ["before the first response", [undefined, null, 0], 3000],
    ["while in flight", ["bridge_pending", null, 0], 3000],
    ["while refunding", ["bridge_refunding", null, 0], 3000],
    ["through a transient upstream", ["bridge_pending", coded("upstream_unavailable"), 0], 3000],
    ["on upstream_conflict", ["bridge_pending", coded("upstream_conflict"), 0], false],
    ["on invalid_request", ["bridge_pending", coded("invalid_request"), 0], false],
    ["on a response that failed its checks", ["bridge_pending", new ParseError("m"), 0], false],
    ["after the handoff", ["deposit_indexed", null, 0], false],
    ["on bridge_partial", ["bridge_partial", null, 0], false],
    ["on bridge_refunded", ["bridge_refunded", null, 0], false],
    ["on bridge_refund_required", ["bridge_refund_required", null, 0], false],
    ["on bridge_failed", ["bridge_failed", null, 0], false],
  ])("answers %s", (_name, args, expected) => {
    expect(bridgeStatusPollInterval(...args)).toBe(expected)
  })
})

describe("createBridgeOptionsQueryOptions", () => {
  it("posts the request identity to the relative options path", async () => {
    const { api, calls } = stubApi(optionsPayload([wireOption()]))
    await runQueryFn(createBridgeOptionsQueryOptions(api, REQUEST, true))
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

  it("rejects a malformed response through the boundary parser", async () => {
    const { api } = stubApi(optionsPayload([wireOption({ min_received: "oops" })]))
    await expect(runQueryFn(createBridgeOptionsQueryOptions(api, REQUEST, true))).rejects.toThrow(
      /invalid min_received/,
    )
  })

  it("retries a failed request but never a parse failure", () => {
    const { api } = stubApi(null)
    const { retry } = createBridgeOptionsQueryOptions(api, REQUEST, true)
    if (typeof retry !== "function") throw new Error("retry must be a predicate")
    expect(retry(0, new Error("Failed to fetch"))).toBe(true)
    expect(retry(0, new ParseError("invalid min_received"))).toBe(false)
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
  it("sends the selected bridge and keys each bridge separately", async () => {
    const { api, calls } = stubApi(quotePayload())
    const across = createBridgeQuoteQueryOptions(api, QUOTE_REQUEST, true)
    const relay = createBridgeQuoteQueryOptions(api, { ...QUOTE_REQUEST, bridge: "relay" }, true)
    expect(relay.queryKey).not.toEqual(across.queryKey)
    await runQueryFn(across)
    expect(calls[0].url).toBe("v1/bridges/quote")
    expect(calls[0].options?.json).toMatchObject({ bridge: "across" })
    expect(calls[0].options?.json).not.toHaveProperty("depositAddress")
  })

  it.each([OTHER_ADDRESS, undefined])(
    "keys the options' deposit address %o and rejects a quote for another",
    async (depositAddress) => {
      const { api } = stubApi(quotePayload())
      const options = createBridgeQuoteQueryOptions(api, { ...QUOTE_REQUEST, depositAddress }, true)
      expect(options.queryKey).not.toEqual(
        createBridgeQuoteQueryOptions(api, QUOTE_REQUEST, true).queryKey,
      )
      await expect(runQueryFn(options)).rejects.toThrow(/deposit_address/)
    },
  )

  it("never keeps previous data", () => {
    const { api } = stubApi(null)
    expect(createBridgeQuoteQueryOptions(api, QUOTE_REQUEST, true).placeholderData).toBeUndefined()
  })

  it("refetches a failed quote on its own but never polls a good one", () => {
    const { refetchInterval } = createBridgeQuoteQueryOptions(
      stubApi(null).api,
      QUOTE_REQUEST,
      true,
    )
    expect(refetchInterval({ state: { status: "error" } })).toBe(10_000)
    expect(refetchInterval({ state: { status: "success" } })).toBe(false)
    expect(refetchInterval({ state: { status: "pending" } })).toBe(false)
  })

  it("rejects a mismatched response through the boundary parser", async () => {
    const { api } = stubApi(quotePayload({ tool: "relay" }))
    await expect(
      runQueryFn(createBridgeQuoteQueryOptions(api, QUOTE_REQUEST, true)),
    ).rejects.toThrow(/tool relay/)
  })
})

describe("createBridgeStatusQueryOptions", () => {
  const PARAMS = {
    srcChainId: "8453",
    srcTxHash: SRC_TX_HASH,
    depositAddress: DEPOSIT_ADDRESS,
  }

  it.each(["cors", "gateway", "api fallback"])(
    "retains the last observation through %s and recovers on the next poll",
    async (failure) => {
      let calls = 0
      const api = ky.create({
        prefixUrl: "https://deposit.test/",
        fetch: async () => {
          calls++
          if (calls === 2) {
            if (failure === "cors") throw new TypeError("Failed to fetch")
            if (failure === "gateway") {
              return new Response("<html>Cloudflare 502 private details</html>", {
                status: 502,
                headers: { "content-type": "text/html" },
              })
            }
            return Response.json(statusPayload({ status_unavailable: true }))
          }
          return Response.json(
            statusPayload({
              state: calls === 1 ? "bridge_refunding" : "bridge_refunded",
              dst_tx_hash: DST_TX_HASH,
              dst_tx_link: "https://etherscan.io/tx/" + DST_TX_HASH,
            }),
          )
        },
      })
      const client = new QueryClient()
      const options = createBridgeStatusQueryOptions(api, PARAMS, true, Date.now())
      try {
        const previous = await client.fetchQuery(options)
        await expect(client.fetchQuery(options)).rejects.toThrow()
        expect(calls).toBe(2) // Neither ky nor React Query retries inside this poll.
        expect(client.getQueryData(options.queryKey)).toEqual(previous)
        const error = client.getQueryState(options.queryKey)?.error ?? null
        expect(error?.message).not.toContain("<html>")
        expect(bridgeStatusPollInterval(previous.state, error, 0)).toBe(3000)
        expect(bridgeStatusPollInterval(previous.state, error, 26 * 60_000)).toBe(15_000)
        expect((await client.fetchQuery(options)).state).toBe("bridge_refunded")
        expect(client.getQueryState(options.queryKey)?.error).toBeNull()
      } finally {
        client.clear()
      }
    },
  )

  // A hinted tool answers 502 upstream_conflict even for not-found results.
  it("polls by source transaction without the bridge hint", async () => {
    const { api, calls } = stubApi(statusPayload())
    await runQueryFn(createBridgeStatusQueryOptions(api, PARAMS, true, Date.now()))
    expect(calls[0].url).toBe("v1/bridges/status")
    expect(calls[0].options?.searchParams).toEqual({
      src_chain_id: "8453",
      src_tx_hash: SRC_TX_HASH,
      deposit_address: DEPOSIT_ADDRESS,
    })
  })

  it("rejects a response for another transaction as a ParseError", async () => {
    const { api } = stubApi(statusPayload({ src_tx_hash: DST_TX_HASH }))
    await expect(
      runQueryFn(createBridgeStatusQueryOptions(api, PARAMS, true, Date.now())),
    ).rejects.toBeInstanceOf(ParseError)
  })

  it("classifies a coded failure instead of normalizing it away", async () => {
    const { api } = stubApi(httpError(502, { error: "upstream_conflict", message: "m" }))
    await expect(
      runQueryFn(createBridgeStatusQueryOptions(api, PARAMS, true, Date.now())),
    ).rejects.toBeInstanceOf(BridgeStatusError)
  })
})
