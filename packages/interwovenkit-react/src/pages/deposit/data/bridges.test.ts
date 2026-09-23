import BigNumber from "bignumber.js"
import { describe, expect, it } from "vitest"
import {
  bridgeQuoteSignature,
  BridgeStatusError,
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
  requiredMinimumAmount,
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
const SENDER = "0x3333333333333333333333333333333333333333"
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

const QUOTE_REQUEST = { ...REQUEST, bridge: "across" }

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
    ["a zero deposit address", withEnvelope({ deposit_address: ZERO_ADDRESS }), /deposit address/],
    [
      "a missing options array",
      { deposit_address: DEPOSIT_ADDRESS, required_min_received: "1" },
      /missing its options array/,
    ],
    ["a null option", optionsPayload([null]), /option 0 is not an object/],
    ["an empty bridge key", withOption({ bridge: "" }), /invalid bridge key/],
    ["a non-string bridge key", withOption({ bridge: 1 }), /invalid bridge key/],
    [
      "bridge keys differing only in casing",
      optionsPayload([wireOption({ bridge: "Across" }), wireOption({ bridge: "across" })]),
      /repeats the bridge key/,
    ],
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

  it.each<[string, Record<string, unknown>]>([
    ["absent", {}],
    ["null", { execution_duration_seconds: null, gas_cost_usd: null }],
    ["an empty gas cost", { gas_cost_usd: "" }],
  ])("keeps %s estimates unknown rather than zero", (_name, overrides) => {
    const [parsed] = parseBridgeOptions(withOption(overrides), REQUEST).options
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

  it("prefers the fastest route within 0.5% of the best net value", () => {
    expect(
      keys([
        option({ bridge: "slow", amount_out: usdc("100"), execution_duration_seconds: 1200 }),
        option({ bridge: "fast", amount_out: usdc("99.6"), execution_duration_seconds: 4 }),
        option({ bridge: "mid", amount_out: usdc("99.8"), execution_duration_seconds: 60 }),
      ]),
    ).toEqual(["fast", "mid", "slow"])
  })

  it("keeps a route worth more than 0.5% more ahead of a faster one", () => {
    expect(
      keys([
        option({ bridge: "fast", amount_out: usdc("99.4"), execution_duration_seconds: 4 }),
        option({ bridge: "rich", amount_out: usdc("100"), execution_duration_seconds: 1200 }),
      ]),
    ).toEqual(["rich", "fast"])
  })

  it("treats a gap under five cents as competitive even when it exceeds 0.5% of a small deposit", () => {
    expect(
      keys([
        option({ bridge: "slow", amount_out: usdc("0.5"), execution_duration_seconds: 628 }),
        option({ bridge: "fast", amount_out: usdc("0.47"), execution_duration_seconds: 106 }),
        option({ bridge: "far", amount_out: usdc("0.44"), execution_duration_seconds: 3 }),
      ]),
    ).toEqual(["fast", "slow", "far"])
  })

  it("ranks Stargate Fast first at 1 USDC despite its higher gas", () => {
    expect(
      keys([
        option({
          bridge: "stargateV2Bus",
          amount_out: usdc("1"),
          execution_duration_seconds: 606,
          gas_cost_usd: "0.022",
        }),
        option({
          bridge: "glacis",
          amount_out: usdc("1"),
          execution_duration_seconds: 1200,
          gas_cost_usd: "0.03",
        }),
        option({
          bridge: "stargateV2",
          amount_out: usdc("1"),
          execution_duration_seconds: 61,
          gas_cost_usd: "0.045",
        }),
      ]),
    ).toEqual(["stargateV2", "stargateV2Bus", "glacis"])
  })

  it("nets the quoted gas out of the output before comparing", () => {
    expect(
      keys([
        option({
          bridge: "gassy",
          amount_out: usdc("100"),
          execution_duration_seconds: 10,
          gas_cost_usd: "2",
        }),
        option({ bridge: "lean", amount_out: usdc("99"), execution_duration_seconds: 600 }),
      ]),
    ).toEqual(["lean", "gassy"])
  })

  it("never lets an ineligible route set the best value", () => {
    expect(
      keys([
        option({ bridge: "ineligible", amount_out: usdc("200"), eligible: false }),
        option({ bridge: "slow", amount_out: usdc("100"), execution_duration_seconds: 600 }),
        option({ bridge: "fast", amount_out: usdc("99.8"), execution_duration_seconds: 10 }),
      ]),
    ).toEqual(["fast", "slow", "ineligible"])
  })

  it("orders routes outside the tolerance by net value, not speed", () => {
    expect(
      keys([
        option({
          bridge: "a",
          eligible: false,
          amount_out: usdc("80"),
          execution_duration_seconds: 5,
        }),
        option({ bridge: "b", amount_out: usdc("90"), execution_duration_seconds: 10 }),
        option({
          bridge: "c",
          eligible: false,
          amount_out: usdc("85"),
          execution_duration_seconds: 900,
        }),
        option({ bridge: "d", amount_out: usdc("95"), execution_duration_seconds: 600 }),
        option({ bridge: "e", amount_out: usdc("100"), execution_duration_seconds: 1200 }),
      ]),
    ).toEqual(["e", "d", "b", "c", "a"])
  })

  it("never ranks a route without a gas estimate ahead of one with a known estimate", () => {
    expect(
      keys([
        option({
          bridge: "unpriced",
          amount_out: usdc("1"),
          execution_duration_seconds: 4,
          gas_cost_usd: undefined,
        }),
        option({
          bridge: "priced",
          amount_out: usdc("0.99"),
          execution_duration_seconds: 600,
          gas_cost_usd: "0.02",
        }),
      ]),
    ).toEqual(["priced", "unpriced"])
  })

  it("sorts an unknown duration after every known one among competitive routes", () => {
    expect(
      keys([
        option({ bridge: "across" }),
        option({ bridge: "relay", execution_duration_seconds: 3000 }),
      ]),
    ).toEqual(["relay", "across"])
  })

  it("breaks a duration and net value tie by the lower gas cost", () => {
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

describe("parseBridgeQuote", () => {
  it("returns the executable quote", () => {
    const quote = parseBridgeQuote(quotePayload(), QUOTE_REQUEST)
    expect(quote.provider).toBe("lifi")
    expect(quote.tool).toBe("across")
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
    ["a zero deposit address", quotePayload({ deposit_address: ZERO_ADDRESS }), /deposit address/],
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

  it("accepts the selected bridge in different casing", () => {
    expect(parseBridgeQuote(quotePayload({ tool: "Across" }), QUOTE_REQUEST).tool).toBe("Across")
  })

  it("compares EVM denoms case-insensitively", () => {
    const payload = quotePayload({ src_denom: BASE_USDC.toLowerCase() })
    expect(parseBridgeQuote(payload, QUOTE_REQUEST).src_denom).toBe(BASE_USDC.toLowerCase())
  })

  it.each([undefined, null, "fast"])("treats an estimate of %o as unknown", (estimate) => {
    expect(parseBridgeQuote(quotePayload({ estimate }), QUOTE_REQUEST).estimate).toEqual({
      execution_duration_seconds: undefined,
      gas_cost_usd: undefined,
    })
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
      ["sent to the zero address", withTransaction({ to: ZERO_ADDRESS }), /invalid to/],
      ["with non-hex calldata", withTransaction({ data: "zzzz" }), /non-hex calldata/],
      ["that is not an object", quotePayload({ transaction: null }), /malformed transaction/],
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

  describe("approval", () => {
    it.each([
      ["that is null", withApproval(null), /missing the ERC-20 approval/],
      [
        "for another token",
        withApproval({ token_address: "0x0000000000000000000000000000000000000dEaD" }),
        /approval token_address mismatch/,
      ],
      [
        "with a zero spender",
        withApproval({ spender_address: ZERO_ADDRESS }),
        /approval spender_address is invalid/,
      ],
      [
        "with a malformed spender",
        withApproval({ spender_address: "0xbeef" }),
        /approval spender_address is invalid/,
      ],
      ["below the transfer amount", withApproval({ amount: "1" }), /approval amount is invalid/],
      [
        "above the transfer amount",
        withApproval({ amount: "5000001" }),
        /approval amount is invalid/,
      ],
    ])("rejects an approval %s", (_name, payload, message) => {
      expect(() => parseBridgeQuote(payload, QUOTE_REQUEST)).toThrow(message)
    })

    it("matches the approval token case-insensitively", () => {
      expect(
        parseBridgeQuote(withApproval({ token_address: BASE_USDC.toLowerCase() }), QUOTE_REQUEST)
          .approval.token_address,
      ).toBe(BASE_USDC.toLowerCase())
    })
  })
})

describe("bridgeQuoteSignature", () => {
  const signatureOf = (payload: ReturnType<typeof quotePayload>) =>
    bridgeQuoteSignature(parseBridgeQuote(payload, QUOTE_REQUEST))
  const reviewed = signatureOf(quotePayload())

  it.each([
    ["the tool's casing", quotePayload({ tool: "Across" })],
    ["address casing", quotePayload({ deposit_address: DEPOSIT_ADDRESS.toLowerCase() })],
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
    [
      "deposit address",
      quotePayload({ deposit_address: "0x7777777777777777777777777777777777777777" }),
    ],
  ])("changes with the %s", (_name, payload) => {
    expect(signatureOf(payload)).not.toBe(reviewed)
  })
})

describe("meetsRequiredMinimum", () => {
  it.each([
    ["1000", "900", "1000", true],
    ["1000", "1001", "900", false],
    ["1000", "900", "1001", false],
    ["10000000", "9000000", "0", true],
    ["", "1", "1", false],
    ["0", "0", "0", false],
    ["1000", "", "1", false],
    ["1000", "1", "1.5", false],
  ])("min_received %o against %o and %o is %s", (minReceived, required, routeMin, expected) => {
    expect(meetsRequiredMinimum({ min_received: minReceived }, required, routeMin)).toBe(expected)
  })
})

describe("requiredMinimumAmount", () => {
  it.each([
    ["900", "1000", "1000"],
    ["1001", "900", "1001"],
    ["10000000", "0", "10000000"],
    ["", "1", undefined],
    ["1", "1.5", undefined],
  ])("%o against %o returns %o", (required, routeMin, expected) => {
    expect(requiredMinimumAmount(required, routeMin)).toBe(expected)
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
  it.each([8453, "8453"])("binds the src_chain_id %o to the request", (src_chain_id) => {
    expect(parseBridgeStatus(statusPayload({ src_chain_id }), EXPECTED).src_chain_id).toBe("8453")
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

  it("normalizes an uncoded, unparseable or non-HTTP failure", async () => {
    const uncoded = await classifyBridgeStatusError(httpError(500, { message: "boom" })).catch(
      (e: unknown) => e,
    )
    expect(uncoded).not.toBeInstanceOf(BridgeStatusError)
    expect(uncoded).toMatchObject({ message: "boom" })
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
  })

  it("keys a reissued deposit address separately without sending it", async () => {
    const { api, calls } = stubApi(quotePayload())
    const base = createBridgeQuoteQueryOptions(api, QUOTE_REQUEST, true)
    const reissued = createBridgeQuoteQueryOptions(
      api,
      { ...QUOTE_REQUEST, depositAddress: DEPOSIT_ADDRESS },
      true,
    )
    expect(reissued.queryKey).not.toEqual(base.queryKey)
    await runQueryFn(reissued)
    expect(calls[0].options?.json).not.toHaveProperty("depositAddress")
  })

  it("never keeps previous data", () => {
    const { api } = stubApi(null)
    expect(createBridgeQuoteQueryOptions(api, QUOTE_REQUEST, true).placeholderData).toBeUndefined()
  })

  it("rejects a mismatched response through the boundary parser", async () => {
    const { api } = stubApi(quotePayload({ tool: "relay" }))
    await expect(
      runQueryFn(createBridgeQuoteQueryOptions(api, QUOTE_REQUEST, true)),
    ).rejects.toThrow(/tool mismatch/)
  })
})

describe("createBridgeStatusQueryOptions", () => {
  const PARAMS = {
    srcChainId: "8453",
    srcTxHash: SRC_TX_HASH,
    depositAddress: DEPOSIT_ADDRESS,
  }

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
