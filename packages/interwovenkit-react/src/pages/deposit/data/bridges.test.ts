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
  parseBridgeOptions,
  parseBridgeQuote,
  parseBridgeStatus,
  percentDifference,
  rankBridgeOptions,
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

  // The live 3 USDC Arbitrum case: Stargate's messaging fee is paid on top as native value.
  it("counts fees paid on top, so a route charging one can't win as if it were free", () => {
    const routes = [
      option({
        bridge: "stargate",
        amount_out: "2977239",
        execution_duration_seconds: 5,
        gas_cost_usd: "0.031",
        fee_cost_usd: "1.6466",
      }),
      option({
        bridge: "polymer",
        amount_out: "2962156",
        execution_duration_seconds: 10,
        gas_cost_usd: "0.0182",
      }),
    ]
    expect(keys(routes)).toEqual(["polymer", "stargate"])
  })

  it("never ranks a route whose fees are unknown ahead of one whose fees are known", () => {
    expect(
      keys([
        option({ bridge: "unknown", amount_out: usdc("1"), fee_cost_usd: undefined }),
        option({ bridge: "known", amount_out: usdc("0.99"), execution_duration_seconds: 600 }),
      ]),
    ).toEqual(["known", "unknown"])
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
