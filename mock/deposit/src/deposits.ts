// GET /v1/deposits* handlers, reproducing the backend's handleListDeposits
// contract: filter validation order, error messages, empty-result issuance
// judgment, and limit+1 pagination.

import type { Context, Hono } from "hono"
import type { Deposit } from "../../../packages/interwovenkit-react/src/pages/deposit/data/types.ts"
import { normalizeWalletAddress } from "./bech32.ts"
import type { DepositCursor, PageBoundary } from "./cursor.ts"
import {
  INVALID_CURSOR_MESSAGE,
  isInvalidCursorError,
  newContinuationCursor,
  parseCursor,
} from "./cursor.ts"
import type { SimDeposit } from "./state.ts"
import { findDepositBySourceTx, findMappingByAddress, getDeposit, listDeposits } from "./state.ts"
import { isTerminalStatus, parseDepositStatus } from "./statusMachine.ts"

const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 100

class BadRequestError extends Error {}

const trimmedQuery = (c: Context, key: string): string => (c.req.query(key) ?? "").trim()

// The backend parses limit with ParseInt(..., 32), so int32 overflow is a
// parse error, not a clamp.
const INT32_MAX = 2_147_483_647

function parseLimit(c: Context): number {
  const raw = trimmedQuery(c, "limit")
  if (raw === "") return DEFAULT_LIST_LIMIT
  const parsed = Number(raw)
  if (!/^\+?\d+$/.test(raw) || parsed <= 0 || parsed > INT32_MAX) {
    throw new BadRequestError("limit must be a positive integer")
  }
  // Between 100 and int32 max is not an error: the backend clamps to 100.
  return Math.min(parsed, MAX_LIST_LIMIT)
}

// The two boolean filters intentionally differ, mirroring the backend:
// `active` is read by value (Get), so an empty value counts as absent, while
// `after_or_active` is read by key presence, so `?after_or_active=` is a
// rejected empty boolean.
function parseActiveFilter(c: Context): boolean | undefined {
  const raw = trimmedQuery(c, "active").toLowerCase()
  if (raw === "") return undefined
  if (raw === "true") return true
  if (raw === "false") return false
  throw new BadRequestError("active must be true or false")
}

function parseAfterOrActiveFilter(c: Context): boolean | undefined {
  if (!c.req.queries("after_or_active")) return undefined
  const raw = trimmedQuery(c, "after_or_active").toLowerCase()
  if (raw === "true") return true
  if (raw === "false") return false
  throw new BadRequestError("after_or_active must be true or false")
}

// Descending (observed_at, created_at, id) — the backend's list order.
function compareDesc(a: SimDeposit, b: SimDeposit): number {
  if (a.observedAtMs !== b.observedAtMs) return b.observedAtMs - a.observedAtMs
  if (a.createdAtMs !== b.createdAtMs) return b.createdAtMs - a.createdAtMs
  return b.record.id.localeCompare(a.record.id)
}

// The exclusive page boundary: (observed_at, created_at, id) < (before...).
function isBeforeBoundary(sim: SimDeposit, boundary: PageBoundary): boolean {
  if (sim.observedAtMs !== boundary.observedAtMs) return sim.observedAtMs < boundary.observedAtMs
  if (sim.createdAtMs !== boundary.createdAtMs) return sim.createdAtMs < boundary.createdAtMs
  return sim.record.id.localeCompare(boundary.id) < 0
}

function handleListDeposits(c: Context): Response {
  let wallet = trimmedQuery(c, "wallet_address")
  if (wallet !== "") {
    const normalized = normalizeWalletAddress(wallet)
    if (!normalized) {
      throw new BadRequestError("wallet_address must be a valid init bech32 or 0x EVM address")
    }
    wallet = normalized
  }
  const depositAddress = trimmedQuery(c, "deposit_address")
  if (depositAddress !== "" && !/^0[xX][0-9a-fA-F]{40}$/.test(depositAddress)) {
    throw new BadRequestError("deposit_address must be a valid 0x EVM address")
  }
  if (wallet === "" && depositAddress === "") {
    throw new BadRequestError("wallet_address or deposit_address is required")
  }
  const limit = parseLimit(c)

  const rawStatus = trimmedQuery(c, "status")
  const status = rawStatus === "" ? undefined : parseDepositStatus(rawStatus)
  if (rawStatus !== "" && !status) throw new BadRequestError("status is invalid")
  const active = parseActiveFilter(c)
  const afterOrActive = parseAfterOrActiveFilter(c)
  if (status && active !== undefined) {
    throw new BadRequestError("status and active cannot both be set")
  }
  if (afterOrActive !== undefined && (status || active !== undefined)) {
    throw new BadRequestError("after_or_active cannot be combined with active or status")
  }

  const rawAfter = trimmedQuery(c, "after")
  let cursor: DepositCursor = { afterCreatedAtMs: null, boundary: null }
  if (rawAfter !== "") {
    try {
      cursor = parseCursor(rawAfter)
    } catch (error) {
      if (!isInvalidCursorError(error)) throw error
      console.warn("invalid deposit cursor", (error as Error).message)
      throw new BadRequestError(INVALID_CURSOR_MESSAGE)
    }
  }
  if (afterOrActive !== undefined && cursor.afterCreatedAtMs === null) {
    throw new BadRequestError("after_or_active requires after")
  }
  // The backend rejects a watermark later than the database clock; the mock's
  // clock is the local one, so "the future" is simply after now.
  if (cursor.afterCreatedAtMs !== null && cursor.afterCreatedAtMs > Date.now()) {
    throw new BadRequestError(INVALID_CURSOR_MESSAGE)
  }

  let items = listDeposits()
  if (depositAddress !== "") {
    const target = depositAddress.toLowerCase()
    items = items.filter((sim) => sim.record.deposit_address.toLowerCase() === target)
  }
  if (wallet !== "") items = items.filter((sim) => sim.record.wallet_address === wallet)
  if (status) items = items.filter((sim) => sim.record.status === status)
  if (active !== undefined) {
    items = items.filter((sim) => isTerminalStatus(sim.record.status) !== active)
  }
  if (cursor.afterCreatedAtMs !== null) {
    const watermark = cursor.afterCreatedAtMs
    items = afterOrActive
      ? // The union filter: created after the watermark OR still in flight.
        items.filter((sim) => sim.createdAtMs > watermark || !isTerminalStatus(sim.record.status))
      : items.filter((sim) => sim.createdAtMs > watermark)
  }
  const boundary = cursor.boundary
  if (boundary) items = items.filter((sim) => isBeforeBoundary(sim, boundary))
  const sorted = items.toSorted(compareDesc)

  // The issuance judgment runs only on an empty result (backend behavior):
  // deposits existing at the address prove it was issued.
  if (sorted.length === 0 && depositAddress !== "") {
    const issued = findMappingByAddress(depositAddress)
    if (!issued) return c.json({ error: "deposit not found" }, 404)
    if (wallet !== "" && issued.walletAddress !== wallet) {
      throw new BadRequestError("deposit_address does not match wallet_address")
    }
  }

  const hasMore = sorted.length > limit
  const page = hasMore ? sorted.slice(0, limit) : sorted
  let nextCursor: string | undefined
  if (hasMore) {
    const last = page[page.length - 1]
    nextCursor = newContinuationCursor(cursor, {
      observedAtMs: last.observedAtMs,
      createdAtMs: last.createdAtMs,
      id: last.record.id,
    })
  }

  // Echo the deposit_address in the checksummed casing the mock knows (the
  // backend checksums the input; matching was case-insensitive against the
  // stored checksummed form).
  const echoedAddress =
    depositAddress === ""
      ? undefined
      : (page[0]?.record.deposit_address ??
        findMappingByAddress(depositAddress)?.depositAddress ??
        depositAddress)

  return c.json({
    ...(wallet !== "" ? { wallet_address: wallet } : {}),
    ...(echoedAddress ? { deposit_address: echoedAddress } : {}),
    ...(status ? { status } : {}),
    ...(active !== undefined ? { active } : {}),
    ...(afterOrActive !== undefined ? { after_or_active: afterOrActive } : {}),
    deposits: page.map((sim) => sim.record),
    has_more: hasMore,
    ...(nextCursor ? { next_cursor: nextCursor } : {}),
  })
}

const isCanonicalUuid = (value: string): boolean =>
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)

function handleGetDeposit(c: Context): Response {
  const id = (c.req.param("id") ?? "").trim()
  if (!isCanonicalUuid(id)) return c.json({ error: "invalid deposit id" }, 400)
  const sim = getDeposit(id.toLowerCase())
  if (!sim) return c.json({ error: "deposit not found" }, 404)
  return c.json(sim.record satisfies Deposit)
}

function handleGetDepositBySourceTx(c: Context): Response {
  const srcChainId = trimmedQuery(c, "src_chain_id")
  if (srcChainId === "") return c.json({ error: "src_chain_id is required" }, 400)
  const txHash = (c.req.param("tx_hash") ?? "").trim().toLowerCase()
  if (txHash === "") return c.json({ error: "tx_hash is required" }, 400)
  const sim = findDepositBySourceTx(srcChainId, txHash)
  if (!sim) return c.json({ error: "deposit not found" }, 404)
  return c.json(sim.record satisfies Deposit)
}

export function registerDepositRoutes(app: Hono): void {
  app.get("/v1/deposits", (c) => {
    try {
      return handleListDeposits(c)
    } catch (error) {
      if (error instanceof BadRequestError) return c.json({ error: error.message }, 400)
      throw error
    }
  })
  // Registered before /v1/deposits/:id so "by-source-tx" is not read as an id.
  app.get("/v1/deposits/by-source-tx/:tx_hash", handleGetDepositBySourceTx)
  app.get("/v1/deposits/:id", handleGetDeposit)
}
