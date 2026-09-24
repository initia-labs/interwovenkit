import type { KyInstance } from "ky"
import { HTTPError, type NormalizedOptions } from "ky"
import type { SkipToken } from "@tanstack/react-query"
import { ETHEREUM_USDC_DENOM } from "./source"
import type { Deposit } from "./types"

export const DEPOSIT_ADDRESS = "0xAbCd000000000000000000000000000000000001"
export const RECIPIENT = "init1recipient"
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

export function runQueryFn<T>(options: {
  queryFn?: ((context: never) => T | Promise<T>) | SkipToken
}): Promise<T> {
  const { queryFn } = options
  if (typeof queryFn !== "function") throw new Error("queryFn must be a function")
  return Promise.resolve(queryFn({} as never))
}

export const deposit = (overrides: Partial<Deposit> = {}): Deposit => ({
  id: "d1",
  src_chain_id: "1",
  src_tx_hash: SRC_TX_HASH,
  src_log_index: 0,
  src_denom: ETHEREUM_USDC_DENOM,
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
