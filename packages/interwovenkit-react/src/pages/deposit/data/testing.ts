// Fixtures shared by the Deposit API data tests, so one test's idea of a
// well-formed deposit (or of a ky failure) cannot drift from another's.

import type { KyInstance } from "ky"
import { HTTPError, type NormalizedOptions } from "ky"
import type { BridgeOption, Deposit } from "./types"

/** Canonical Ethereum USDC: the asset every route finally delivers. */
export const ETHEREUM_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
export const DEPOSIT_ADDRESS = "0xAbCd000000000000000000000000000000000001"
/** Final credited wallet, init bech32. */
export const RECIPIENT = "init1recipient"
/** The source-chain transaction the user signs. */
export const SRC_TX_HASH = `0x${"a".repeat(64)}`
/** The Ethereum leg: a bridge's destination transaction, and the deposit's own `src_tx_hash`. */
export const DST_TX_HASH = `0x${"b".repeat(64)}`

/** A ky failure. Without a body the response is deliberately unparseable JSON. */
export const httpError = (status: number, body?: object, headers?: Record<string, string>) =>
  new HTTPError(
    new Response(body ? JSON.stringify(body) : "not json", {
      status,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers },
    }),
    new Request("https://deposit.test/"),
    {} as NormalizedOptions,
  )

export interface Call {
  url: string
  options?: { json?: unknown; searchParams?: Record<string, string> }
}

/** A ky stand-in: every verb records its call and answers `result`, rejecting when it is an Error. */
export function stubApi(result: unknown) {
  const calls: Call[] = []
  const respond = (url: string, options?: Call["options"]) => {
    calls.push({ url, options })
    return {
      json: () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)),
    }
  }
  return { api: { get: respond, post: respond } as unknown as KyInstance, calls }
}

/** A complete wire deposit; override only the fields under test. */
export const deposit = (overrides: Partial<Deposit> = {}): Deposit => ({
  id: "d1",
  src_chain_id: "1",
  src_tx_hash: SRC_TX_HASH,
  src_log_index: 0,
  src_denom: ETHEREUM_USDC,
  amount: "5000000",
  deposit_address: DEPOSIT_ADDRESS,
  wallet_address: RECIPIENT,
  dst_chain_id: "interwoven-1",
  dst_denom: "uusdc",
  dst_address: RECIPIENT,
  observed_height: 1,
  observed_at: "",
  status: "detected",
  bucket: "waiting",
  status_updated_at: "",
  created_at: "",
  updated_at: "",
  bot_tx_hash: "",
  bot_tx_explorer_url: "",
  ...overrides,
})

/** A parsed, eligible route. Gas is priced so ranking always has a net value to compare. */
export const option = (overrides: Partial<BridgeOption> & { bridge: string }): BridgeOption => ({
  amount_out: "1000",
  min_received: "1000",
  eligible: true,
  gas_cost_usd: "0",
  ...overrides,
})
