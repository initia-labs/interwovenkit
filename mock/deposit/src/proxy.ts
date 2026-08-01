// Upstream passthrough plus the observations the simulation needs: the
// deposit-address handler records the issued mapping and rewrites the response
// cursor to a mock-issued watermark, and the assets cache backs source-route
// resolution for fake deposits.

import type { Context } from "hono"
import type {
  Asset,
  DepositAddressResponse,
  ListAssetsResponse,
} from "../../../packages/interwovenkit-react/src/pages/deposit/data/types.ts"
import { newWatermarkCursor } from "./cursor.ts"
import type { AddressMapping } from "./state.ts"
import { findMappingByTriple, recordAddressMapping } from "./state.ts"

export const UPSTREAM_URL = (process.env.UPSTREAM_URL ?? "https://deposit-api.initia.xyz").replace(
  /\/+$/,
  "",
)

// Mirrors the upstream CORS allowlist; anything else never reaches the mock
// because the browser blocks the preflight.
const FORWARD_HEADERS = ["authorization", "content-type", "x-correlation-id", "x-request-id"]

function forwardHeaders(c: Context): Headers {
  const headers = new Headers()
  for (const name of FORWARD_HEADERS) {
    const value = c.req.header(name)
    if (value) headers.set(name, value)
  }
  return headers
}

// Only the content type survives; hop-by-hop and upstream CORS headers must
// not leak into the mock's own CORS handling.
function proxyResponse(upstream: Response): Response {
  const headers = new Headers()
  const contentType = upstream.headers.get("content-type")
  if (contentType) headers.set("content-type", contentType)
  return new Response(upstream.body, { status: upstream.status, headers })
}

/** Forwards the request to the upstream as-is (status and body included). */
export async function passthrough(c: Context): Promise<Response> {
  const url = new URL(c.req.url)
  const method = c.req.method
  const body = method === "GET" || method === "HEAD" ? undefined : await c.req.arrayBuffer()
  try {
    const upstream = await fetch(UPSTREAM_URL + url.pathname + url.search, {
      method,
      headers: forwardHeaders(c),
      body,
    })
    return proxyResponse(upstream)
  } catch (error) {
    console.error("upstream request failed", url.pathname, error)
    return c.json({ error: "upstream request failed" }, 502)
  }
}

/**
 * POST /v1/deposit-address: passthrough that records the issued mapping and
 * replaces the upstream cursor with a mock-issued watermark, so `after`
 * comparisons run against the same clock that stamps fake deposits.
 */
export async function handleDepositAddress(c: Context): Promise<Response> {
  const body = await c.req.arrayBuffer()
  let upstream: Response
  try {
    upstream = await fetch(`${UPSTREAM_URL}/v1/deposit-address`, {
      method: "POST",
      headers: forwardHeaders(c),
      body,
    })
  } catch (error) {
    console.error("upstream request failed", "/v1/deposit-address", error)
    return c.json({ error: "upstream request failed" }, 502)
  }
  if (!upstream.ok) return proxyResponse(upstream)

  const response = (await upstream.json()) as DepositAddressResponse
  recordAddressMapping({
    depositAddress: response.deposit_address,
    walletAddress: response.wallet_address,
    chainId: response.chain_id,
    assetDenom: response.asset_denom,
  })
  return c.json({ ...response, cursor: newWatermarkCursor(Date.now()) })
}

/** Upstream rejection carrying the status/message to relay to the client. */
export class UpstreamError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * Resolves the deposit address for a destination triple: the recorded mapping if
 * one was already issued, otherwise a real upstream derivation — fake deposits
 * always sit at real derived addresses, matching what the widget displays.
 */
export async function deriveDepositAddress(
  walletAddress: string,
  chainId: string,
  assetDenom: string,
): Promise<AddressMapping> {
  const existing = findMappingByTriple(walletAddress, chainId, assetDenom)
  if (existing) return existing

  const upstream = await fetch(`${UPSTREAM_URL}/v1/deposit-address`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      wallet_address: walletAddress,
      chain_id: chainId,
      asset_denom: assetDenom,
    }),
  })
  if (!upstream.ok) {
    let message: string | undefined
    try {
      message = ((await upstream.json()) as { error?: string }).error
    } catch {
      // Non-JSON error body: fall back to the generic message below.
    }
    throw new UpstreamError(upstream.status, message ?? "failed to issue deposit address")
  }
  const response = (await upstream.json()) as DepositAddressResponse
  const mapping: AddressMapping = {
    depositAddress: response.deposit_address,
    walletAddress: response.wallet_address,
    chainId: response.chain_id,
    assetDenom: response.asset_denom,
  }
  recordAddressMapping(mapping)
  return mapping
}

const ASSETS_TTL_MS = 5 * 60_000
let assetsCache: { assets: Asset[]; fetchedAtMs: number } | null = null

/** Upstream GET /v1/config/assets, cached briefly (route metadata is near static). */
export async function fetchAssets(): Promise<Asset[]> {
  if (assetsCache && Date.now() - assetsCache.fetchedAtMs < ASSETS_TTL_MS) {
    return assetsCache.assets
  }
  const upstream = await fetch(`${UPSTREAM_URL}/v1/config/assets`)
  if (!upstream.ok) throw new Error(`failed to fetch upstream assets: ${upstream.status}`)
  const { assets } = (await upstream.json()) as ListAssetsResponse
  assetsCache = { assets, fetchedAtMs: Date.now() }
  return assets
}

interface QuoteParams {
  srcChainId: string
  srcDenom: string
  dstChainId: string
  dstDenom: string
  amountIn: string
}

/** Upstream GET /v1/quote; null on any failure (callers approximate instead). */
export async function fetchQuote(params: QuoteParams): Promise<string | null> {
  const search = new URLSearchParams({
    src_chain_id: params.srcChainId,
    src_denom: params.srcDenom,
    dst_chain_id: params.dstChainId,
    dst_denom: params.dstDenom,
    amount_in: params.amountIn,
  })
  try {
    const upstream = await fetch(`${UPSTREAM_URL}/v1/quote?${search}`)
    if (!upstream.ok) return null
    const { amount_out } = (await upstream.json()) as { amount_out?: string }
    return amount_out || null
  } catch (error) {
    // Persistent failures (e.g. a misconfigured UPSTREAM_URL) would otherwise
    // degrade every amount_out to an approximation with no trace.
    console.warn("upstream quote failed; callers will approximate", error)
    return null
  }
}
