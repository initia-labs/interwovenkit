import { ETHEREUM_USDC, IUSD, RECIPIENT } from "./constants"

/* Deposit API fake.
 *
 * Every response shape here comes from the saved staging OpenAPI
 * (`staging-contract-evidence.json`, v0.0.32): the wallet flow's boundary
 * parsers reject anything else, so a drifting fixture fails as a parse error
 * rather than silently testing a contract the backend does not have. */

export interface Reply {
  status: number
  body?: unknown
  headers?: Record<string, string>
}

export interface RequestContext {
  method: string
  /** Path without the leading slash, e.g. `v1/bridges/quote`. */
  path: string
  url: URL
  json: Record<string, unknown>
  /** Zero-based call index for this endpoint. */
  index: number
}

export type Responder = (ctx: RequestContext) => Reply

export const ok = (body: unknown): Reply => ({ status: 200, body })
/** The API-wide error shape: `{ message }`. */
export const fail = (status: number, message: string): Reply => ({ status, body: { message } })
/** Bridge-status only: `{ error, message }` (field `error`, not `code`). */
export const coded = (status: number, error: string, message: string): Reply => ({
  status,
  body: { error, message },
})
export const notFound = (): Reply => ({ status: 404, body: { message: "not found" } })

/** Replies in order; the last one repeats for every later call. */
export function sequence(replies: (Reply | Responder)[]): Responder {
  return (ctx) => {
    const entry = replies[Math.min(ctx.index, replies.length - 1)]
    return typeof entry === "function" ? entry(ctx) : entry
  }
}

// --- Fixture data -----------------------------------------------------------

/** `/v1/config/assets`: the Ethereum USDC → iUSD route every transport delivers through. */
export function ethereumUsdcAsset(overrides: Record<string, unknown> = {}) {
  return {
    src_chain_id: "1",
    src_denom: ETHEREUM_USDC,
    src_decimals: 6,
    min_deposit_amount: "100000",
    advance_max_amount: "1000000",
    max_slippage_percent: "0.0",
    dst_symbol: IUSD.symbol,
    dst_networks: [
      {
        chain_id: IUSD.chainId,
        chain_name: "Initia",
        denom: IUSD.denom,
        decimals: IUSD.decimals,
        vm_type: "move",
        processing_time_seconds: 30,
      },
    ],
    ...overrides,
  }
}

export interface DepositOverrides {
  [key: string]: unknown
}

/** A `Deposit` with every field the SDK's boundary parsers require. */
export function makeDeposit(overrides: DepositOverrides = {}) {
  const now = new Date().toISOString()
  return {
    id: "11111111-2222-3333-4444-555555555555",
    src_chain_id: "1",
    src_tx_hash: `0x${"ab".repeat(32)}`,
    src_log_index: 0,
    src_denom: ETHEREUM_USDC,
    amount: "500000",
    amount_out: "500000",
    deposit_address: "",
    wallet_address: RECIPIENT,
    dst_chain_id: IUSD.chainId,
    dst_denom: IUSD.denom,
    dst_address: RECIPIENT,
    observed_height: 21_000_100,
    observed_at: now,
    status: "detected",
    bucket: "waiting",
    status_reason: "",
    status_updated_at: now,
    created_at: now,
    updated_at: now,
    bot_tx_hash: "",
    bot_tx_explorer_url: "",
    advance_status: "none",
    advance_tx_hash: "",
    advance_tx_explorer_url: "",
    reclaim_status: "none",
    ...overrides,
  }
}

export interface ApiScenario {
  assets: Responder
  depositAddress: Responder
  quote: Responder
  bridgeOptions: Responder
  bridgeQuote: Responder
  bridgeStatus: Responder
  bySourceTx: Responder
  deposit: Responder
  deposits: Responder
}

export interface ApiMock {
  scenario: ApiScenario
  /** Every intercepted request, in order. */
  requests: { method: string; path: string; search: string; json: Record<string, unknown> }[]
  /** Mutable shared facts the default responders build their answers from. */
  state: {
    depositAddress: string
    /** Bridge options for the LI.FI path; the default quote responder reads it too. */
    options: {
      bridge: string
      amount_out: string
      min_received: string
      eligible: boolean
      execution_duration_seconds?: number
      gas_cost_usd?: string
    }[]
    requiredMinReceived: string
    /** Bumped to change the quote under a refresh (stale-quote reconfirmation). */
    quoteRevision: number
    approvalSpender: string
    /** Verbatim LI.FI transaction fields the client must sign unchanged. */
    bridgeTx: { to: string; data: string; value: string; gas_limit?: string }
  }
  counts: Record<string, number>
  /** Answers one intercepted Deposit API request. */
  handle(request: { method: string; url: URL; body: string | null }): Reply
}

const DEFAULT_OPTIONS: ApiMock["state"]["options"] = [
  {
    bridge: "across",
    amount_out: "498000",
    min_received: "497000",
    eligible: true,
    execution_duration_seconds: 60,
    gas_cost_usd: "1.25",
  },
  {
    bridge: "stargateV2",
    amount_out: "496500",
    min_received: "495000",
    eligible: true,
    execution_duration_seconds: 120,
    gas_cost_usd: "2.10",
  },
  {
    bridge: "symbiosis",
    amount_out: "90000",
    min_received: "80000",
    eligible: false,
    execution_duration_seconds: 300,
  },
]

export function createDepositApiMock(): ApiMock {
  const mock: ApiMock = {
    requests: [],
    counts: {},
    handle: () => fail(500, "not installed"),
    state: {
      depositAddress: "0x9f1B4B1F2C3d4e5F60718293A4b5c6d7e8f90123",
      options: DEFAULT_OPTIONS.map((option) => ({ ...option })),
      requiredMinReceived: "100000",
      quoteRevision: 0,
      approvalSpender: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
      bridgeTx: {
        to: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
        data: `0x4666fc80${"ab".repeat(64)}`,
        // Nonzero native protocol fee: the client must forward it verbatim.
        value: "0x38d7ea4c68000",
        gas_limit: "350000",
      },
    },
    scenario: {
      assets: () => ok({ assets: [ethereumUsdcAsset()] }),
      depositAddress: (ctx) =>
        ok({
          wallet_address: String(ctx.json.wallet_address ?? RECIPIENT),
          chain_id: String(ctx.json.chain_id ?? IUSD.chainId),
          asset_denom: String(ctx.json.asset_denom ?? IUSD.denom),
          deposit_address: mock.state.depositAddress,
          cursor: "v1.Y3Vyc29y",
        }),
      quote: (ctx) => {
        const amountIn = ctx.url.searchParams.get("amount_in") ?? "0"
        return ok({ amount_out: amountIn, min_received: amountIn })
      },
      bridgeOptions: () =>
        ok({
          deposit_address: mock.state.depositAddress,
          required_min_received: mock.state.requiredMinReceived,
          options: mock.state.options,
        }),
      bridgeQuote: (ctx) => ok(defaultBridgeQuote(mock, ctx)),
      bridgeStatus: () => coded(502, "upstream_conflict", "unconfigured bridge status"),
      bySourceTx: () => notFound(),
      deposit: () => ok(makeDeposit({ deposit_address: mock.state.depositAddress })),
      deposits: () => ok({ deposits: [] }),
    },
  }

  const route = (ctx: RequestContext): Reply => {
    const { path } = ctx
    if (path === "v1/config/assets") return mock.scenario.assets(ctx)
    if (path === "v1/deposit-address") return mock.scenario.depositAddress(ctx)
    if (path === "v1/quote") return mock.scenario.quote(ctx)
    if (path === "v1/bridges/options") return mock.scenario.bridgeOptions(ctx)
    if (path === "v1/bridges/quote") return mock.scenario.bridgeQuote(ctx)
    if (path === "v1/bridges/status") return mock.scenario.bridgeStatus(ctx)
    if (path.startsWith("v1/deposits/by-source-tx/")) return mock.scenario.bySourceTx(ctx)
    if (path === "v1/deposits") return mock.scenario.deposits(ctx)
    if (path.startsWith("v1/deposits/")) return mock.scenario.deposit(ctx)
    return fail(404, `unmocked Deposit API path: ${path}`)
  }

  const key = (path: string) =>
    path.startsWith("v1/deposits/by-source-tx/")
      ? "v1/deposits/by-source-tx"
      : path.startsWith("v1/deposits/") && path !== "v1/deposits"
        ? "v1/deposits/:id"
        : path

  mock.handle = ({ method, url, body: raw }) => {
    const path = url.pathname.replace(/^\//, "")
    let json: Record<string, unknown> = {}
    if (raw) {
      try {
        json = JSON.parse(raw) as Record<string, unknown>
      } catch {
        json = {}
      }
    }
    mock.requests.push({ method, path, search: url.search, json })
    const counterKey = key(path)
    const index = mock.counts[counterKey] ?? 0
    mock.counts[counterKey] = index + 1
    return route({ method, path, url, json, index })
  }

  return mock
}

/** The LI.FI quote the form binds to its retained request identity. */
export function defaultBridgeQuote(mock: ApiMock, ctx: RequestContext) {
  const body = ctx.json
  const bridge = String(body.bridge ?? mock.state.options.find((o) => o.eligible)?.bridge ?? "")
  const option = mock.state.options.find((o) => o.bridge === bridge) ?? mock.state.options[0]
  const revision = mock.state.quoteRevision
  return {
    provider: "lifi",
    src_chain_id: String(body.src_chain_id),
    src_denom: String(body.src_denom),
    dst_chain_id: String(body.dst_chain_id),
    dst_denom: String(body.dst_denom),
    amount: String(body.amount),
    wallet_address: String(body.wallet_address),
    deposit_address: mock.state.depositAddress,
    cursor: "v1.Y3Vyc29y",
    // The revision perturbs the reviewed numbers without changing eligibility,
    // which is exactly what the "Quote updated" gate keys on.
    amount_out: String(BigInt(option.amount_out) - BigInt(revision)),
    min_received: String(BigInt(option.min_received) - BigInt(revision)),
    tool: bridge,
    quote_id: `quote-${bridge}-${revision}`,
    estimate: {
      execution_duration_seconds: option.execution_duration_seconds,
      gas_cost_usd: option.gas_cost_usd,
    },
    approval: {
      token_address: String(body.src_denom),
      spender_address: mock.state.approvalSpender,
      amount: String(body.amount),
    },
    transaction: {
      chain_id: String(body.src_chain_id),
      from: String(body.from_address),
      to: mock.state.bridgeTx.to,
      data: mock.state.bridgeTx.data,
      value: mock.state.bridgeTx.value,
      ...(mock.state.bridgeTx.gas_limit ? { gas_limit: mock.state.bridgeTx.gas_limit } : {}),
    },
  }
}
