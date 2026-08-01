// POST /v1/onramper/checkout mock and its fake payment page. Request validation
// mirrors the backend's parseOnramperCheckoutRequest; the payment hand-off
// becomes a mock-hosted page whose "Complete payment" button creates the fake
// deposit (failure creates nothing, matching reality).

import type { Context, Hono } from "hono"
import { html } from "hono/html"
import type { Asset } from "../../../packages/interwovenkit-react/src/pages/deposit/data/types.ts"
import { toBaseUnit } from "./amounts.ts"
import { normalizeWalletAddress } from "./bech32.ts"
import { registerDeposit } from "./lifecycle.ts"
import { deriveDepositAddress, fetchAssets, UpstreamError } from "./proxy.ts"
import type { CheckoutRecord } from "./state.ts"
import { addCheckout, findCheckoutByUuid, getCheckout, getConfig } from "./state.ts"

// Crockford base32, per the ULID spec (the real transaction_id format).
const ULID_CHARSET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

export function generateUlid(nowMs: number): string {
  let time = nowMs
  let timePart = ""
  for (let i = 0; i < 10; i++) {
    timePart = ULID_CHARSET[time % 32] + timePart
    time = Math.floor(time / 32)
  }
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let randomPart = ""
  for (let i = 0; i < 16; i++) randomPart += ULID_CHARSET[bytes[i] % 32]
  return timePart + randomPart
}

const CHECKOUT_FIELDS = [
  "wallet_address",
  "chain_id",
  "asset_denom",
  "onramp",
  "fiat",
  "crypto",
  "network",
  "amount",
  "payment_method",
  "uuid",
] as const

class CheckoutRequestError extends Error {}

interface ParsedCheckoutRequest {
  walletAddress: string
  chainId: string
  assetDenom: string
  onramp: string
  fiat: string
  crypto: string
  network: string
  amount: number
  paymentMethod: string
  uuid: string
}

// Mirrors the backend: DisallowUnknownFields, triple normalization, then the
// required/number checks on the passthrough fields, with identical messages.
function parseCheckoutRequest(body: unknown): ParsedCheckoutRequest {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new CheckoutRequestError("invalid request body")
  }
  const record = body as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!(CHECKOUT_FIELDS as readonly string[]).includes(key)) {
      throw new CheckoutRequestError("invalid request body")
    }
  }
  for (const key of CHECKOUT_FIELDS) {
    const value = record[key]
    if (value !== undefined && key !== "amount" && typeof value !== "string") {
      throw new CheckoutRequestError("invalid request body")
    }
  }

  const stringField = (key: string): string => ((record[key] as string | undefined) ?? "").trim()
  const walletInput = stringField("wallet_address")
  const chainId = stringField("chain_id")
  const assetDenom = stringField("asset_denom")
  if (walletInput === "" || chainId === "" || assetDenom === "") {
    throw new CheckoutRequestError("wallet_address, chain_id, and asset_denom are required")
  }
  const walletAddress = normalizeWalletAddress(walletInput)
  if (!walletAddress) {
    throw new CheckoutRequestError("wallet_address must be a valid init bech32 or 0x EVM address")
  }

  const onramp = stringField("onramp")
  const fiat = stringField("fiat")
  const crypto = stringField("crypto")
  const network = stringField("network")
  const paymentMethod = stringField("payment_method")
  const uuid = stringField("uuid")
  const amount = record.amount
  if (!onramp || !fiat || !crypto || !network || amount === undefined || !paymentMethod || !uuid) {
    throw new CheckoutRequestError(
      "onramp, fiat, crypto, network, amount, payment_method, and uuid are required",
    )
  }
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    throw new CheckoutRequestError("amount must be a JSON number")
  }
  // Beyond the backend mirror: a non-positive amount cannot convert to base
  // units, so reject it here rather than at completion time.
  if (amount <= 0) {
    throw new CheckoutRequestError("amount must be positive")
  }
  return {
    walletAddress,
    chainId,
    assetDenom,
    onramp,
    fiat,
    crypto,
    network,
    amount,
    paymentMethod,
    uuid,
  }
}

const checkoutUrl = (c: Context, transactionId: string): string =>
  `${new URL(c.req.url).origin}/checkout/${transactionId}`

const checkoutTimers = new Set<ReturnType<typeof setTimeout>>()

export function clearCheckoutTimers(): void {
  for (const timer of checkoutTimers) clearTimeout(timer)
  checkoutTimers.clear()
}

async function handleCheckout(c: Context): Promise<Response> {
  const body = await c.req.json().catch(() => null)
  let request: ParsedCheckoutRequest
  try {
    request = parseCheckoutRequest(body)
  } catch (error) {
    if (error instanceof CheckoutRequestError) return c.json({ error: error.message }, 400)
    throw error
  }

  // Idempotency: the same uuid returns the existing checkout instead of
  // minting a duplicate transaction (real Onramper semantics).
  const existing = findCheckoutByUuid(request.uuid)
  if (existing) {
    return c.json({
      transaction_id: existing.transactionId,
      url: checkoutUrl(c, existing.transactionId),
    })
  }

  let depositAddress: string
  try {
    const mapping = await deriveDepositAddress(
      request.walletAddress,
      request.chainId,
      request.assetDenom,
    )
    depositAddress = mapping.depositAddress
  } catch (error) {
    if (error instanceof UpstreamError) {
      return c.json({ error: error.message }, error.status as 400)
    }
    console.error("deposit address derivation failed", error)
    return c.json({ error: "failed to issue deposit address" }, 502)
  }

  const record: CheckoutRecord = {
    transactionId: generateUlid(Date.now()),
    uuid: request.uuid,
    walletAddress: request.walletAddress,
    chainId: request.chainId,
    assetDenom: request.assetDenom,
    depositAddress,
    onramp: request.onramp,
    fiat: request.fiat,
    crypto: request.crypto,
    network: request.network,
    amount: request.amount,
    paymentMethod: request.paymentMethod,
    createdAtMs: Date.now(),
    paid: false,
  }
  addCheckout(record)

  const { checkoutMode, checkoutAutoDelayMs } = getConfig()
  if (checkoutMode === "auto") {
    const timer = setTimeout(() => {
      checkoutTimers.delete(timer)
      completeCheckout(record).catch((error) => {
        console.error(`auto checkout completion failed for ${record.transactionId}`, error)
      })
    }, checkoutAutoDelayMs)
    checkoutTimers.add(timer)
  }

  return c.json({ transaction_id: record.transactionId, url: checkoutUrl(c, record.transactionId) })
}

// Onramper network id -> deposit source chain id. Only Ethereum exists today
// (the widget matches source routes on chain "1" exclusively).
const NETWORK_CHAIN_IDS: Record<string, string> = { ethereum: "1" }

/**
 * Resolves the source route the purchase arrives on by intersecting routes that
 * serve the checkout destination with the Onramper network/crypto. The crypto id
 * ("usdc_ethereum") only disambiguates native vs token — the mock has no Onramper
 * asset metadata, so this is an approximation.
 */
export function resolveSourceRoute(
  assets: Asset[],
  checkout: Pick<CheckoutRecord, "chainId" | "assetDenom" | "network" | "crypto">,
): Asset | null {
  let candidates = assets.filter((asset) =>
    asset.dst_networks.some(
      (network) =>
        network.chain_id === checkout.chainId &&
        network.denom.toLowerCase() === checkout.assetDenom.toLowerCase(),
    ),
  )
  const srcChainId = NETWORK_CHAIN_IDS[checkout.network.toLowerCase()]
  if (srcChainId) {
    const byChain = candidates.filter((asset) => asset.src_chain_id === srcChainId)
    if (byChain.length > 0) candidates = byChain
  }
  const wantsNative = checkout.crypto.split("_")[0].toLowerCase() === "eth"
  const bySymbol = candidates.filter((asset) => asset.src_denom.endsWith("-native") === wantsNative)
  return bySymbol[0] ?? candidates[0] ?? null
}

const completionsInFlight = new Map<string, Promise<void>>()

/**
 * Marks the checkout paid and creates its fake deposit. Idempotent: an
 * already-paid checkout is a no-op, and concurrent calls (auto timer + manual
 * button) share one in-flight completion instead of creating two deposits.
 */
export async function completeCheckout(record: CheckoutRecord): Promise<void> {
  if (record.paid) return
  const inFlight = completionsInFlight.get(record.transactionId)
  if (inFlight) return inFlight
  const completion = performCompletion(record)
  completionsInFlight.set(record.transactionId, completion)
  try {
    await completion
  } finally {
    completionsInFlight.delete(record.transactionId)
  }
}

// Amount is fiat x 10^src_decimals — a 1:1 approximation, precise exchange
// rates are out of scope.
async function performCompletion(record: CheckoutRecord): Promise<void> {
  const assets = await fetchAssets()
  const route = resolveSourceRoute(assets, record)
  if (!route) {
    throw new Error(
      `no source route matches checkout ${record.transactionId} (crypto: ${record.crypto}, network: ${record.network})`,
    )
  }
  // The pre-rollout assets contract omits src_decimals; without it the fiat ->
  // base-unit scale is unknown, so fail loudly rather than use a wrong scale.
  if (typeof route.src_decimals !== "number") {
    throw new Error(
      "upstream assets have no src_decimals; set UPSTREAM_URL to a backend serving the current contract",
    )
  }
  const amount = toBaseUnit(String(record.amount), route.src_decimals)
  if (amount === null) {
    // Reachable when Number -> String yields exponent notation (e.g. 1e21);
    // failing beats a silent "0" that corrupts the scenario.
    throw new Error(
      `checkout ${record.transactionId} amount cannot convert to base units: ${record.amount}`,
    )
  }
  registerDeposit({
    depositAddress: record.depositAddress,
    walletAddress: record.walletAddress,
    dstChainId: record.chainId,
    dstDenom: record.assetDenom,
    srcChainId: route.src_chain_id,
    srcDenom: route.src_denom,
    amount,
    status: "detected",
  })
  // Marked only after the deposit exists: a failed completion stays retryable
  // instead of becoming a permanent paid-without-deposit.
  record.paid = true
}

function paymentPage(record: CheckoutRecord): ReturnType<typeof html> {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Mock checkout · ${record.transactionId}</title>
        <style>
          :root {
            color-scheme: light dark;
          }
          body {
            font-family: system-ui, sans-serif;
            display: grid;
            place-items: center;
            min-height: 100vh;
            margin: 0;
          }
          main {
            width: min(420px, 90vw);
            border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
            border-radius: 12px;
            padding: 24px;
          }
          h1 {
            font-size: 18px;
            margin: 0 0 16px;
          }
          dl {
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 4px 16px;
            font-size: 14px;
            margin: 0 0 24px;
          }
          dt {
            opacity: 0.6;
          }
          dd {
            margin: 0;
            overflow-wrap: anywhere;
            font-variant-numeric: tabular-nums;
          }
          .buttons {
            display: flex;
            gap: 8px;
          }
          button {
            flex: 1;
            font: inherit;
            padding: 10px 16px;
            border-radius: 8px;
            border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
            background: none;
            cursor: pointer;
            touch-action: manipulation;
          }
          button.primary {
            background: #22863a;
            border-color: #22863a;
            color: #fff;
          }
          #result {
            margin-top: 16px;
            font-size: 14px;
            min-height: 1.2em;
          }
        </style>
      </head>
      <body>
        <main>
          <h1>Mock payment — ${record.onramp}</h1>
          <dl>
            <dt>Amount</dt>
            <dd>${String(record.amount)} ${record.fiat.toUpperCase()}</dd>
            <dt>Buying</dt>
            <dd>${record.crypto}</dd>
            <dt>Deliver to</dt>
            <dd>${record.depositAddress}</dd>
          </dl>
          <div class="buttons">
            <button class="primary" id="complete" ${record.paid ? "disabled" : ""}>
              Complete payment
            </button>
            <button id="fail" ${record.paid ? "disabled" : ""}>Fail payment</button>
          </div>
          <p id="result" aria-live="polite">${record.paid ? "Payment already completed." : ""}</p>
        </main>
        <script>
          const result = document.getElementById("result")
          const buttons = [document.getElementById("complete"), document.getElementById("fail")]
          const disable = () => buttons.forEach((button) => (button.disabled = true))
          document.getElementById("complete").addEventListener("click", async () => {
            disable()
            try {
              const response = await fetch(location.pathname + "/complete", { method: "POST" })
              if (response.ok) {
                result.textContent = "Payment completed. Return to the app to track the deposit."
              } else {
                const body = await response.json().catch(() => ({}))
                result.textContent = "Completion failed: " + (body.error ?? response.status)
              }
            } catch {
              // fetch itself rejected (mock restarted, network drop): surface it
              // and re-enable retry instead of leaving a dead page.
              result.textContent = "Completion failed: network error. Retry."
              buttons.forEach((button) => (button.disabled = false))
            }
          })
          document.getElementById("fail").addEventListener("click", () => {
            disable()
            result.textContent = "Payment failed. No deposit was created."
          })
        </script>
      </body>
    </html>`
}

export function registerCheckoutRoutes(app: Hono): void {
  app.post("/v1/onramper/checkout", handleCheckout)

  app.get("/checkout/:transactionId", (c) => {
    const record = getCheckout(c.req.param("transactionId"))
    if (!record) return c.json({ error: "checkout not found" }, 404)
    return c.html(paymentPage(record))
  })

  app.post("/checkout/:transactionId/complete", async (c) => {
    const record = getCheckout(c.req.param("transactionId"))
    if (!record) return c.json({ error: "checkout not found" }, 404)
    try {
      await completeCheckout(record)
    } catch (error) {
      console.error("checkout completion failed", error)
      return c.json({ error: error instanceof Error ? error.message : "completion failed" }, 502)
    }
    return c.json({ transaction_id: record.transactionId, paid: true })
  })
}
