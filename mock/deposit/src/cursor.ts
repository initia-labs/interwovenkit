// Mirror of the backend's deposit_cursor.go: opaque "v1." + base64url(JSON)
// cursors carrying a creation watermark and an optional exclusive page boundary.
// The mock issues its own cursors (deposit-address responses are rewritten) so
// the watermark compares against the mock's local clock, not the upstream's.

const CURSOR_PREFIX = "v1."
const MAX_CURSOR_LENGTH = 512

export const INVALID_CURSOR_MESSAGE = "after is invalid"

/** The exclusive page boundary: the (observed_at, created_at, id) of the last returned row. */
export interface PageBoundary {
  observedAtMs: number
  createdAtMs: number
  id: string
}

// The boundary is a nested all-or-nothing object so a partially-populated
// boundary (the wire format's only invalid shape) is unrepresentable here.
export interface DepositCursor {
  afterCreatedAtMs: number | null
  boundary: PageBoundary | null
}

interface CursorPayload {
  after_created_at?: string
  before_observed_at?: string
  before_created_at?: string
  before_id?: string
}

const PAYLOAD_KEYS = ["after_created_at", "before_observed_at", "before_created_at", "before_id"]

const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/

class InvalidCursorError extends Error {
  constructor(reason: string, options?: ErrorOptions) {
    super(`${INVALID_CURSOR_MESSAGE}: ${reason}`, options)
  }
}

export function isInvalidCursorError(error: unknown): boolean {
  return error instanceof InvalidCursorError
}

const base64UrlEncode = (value: string): string =>
  btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")

function base64UrlDecode(value: string): string {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new InvalidCursorError("payload is not base64url")
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/")
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4)
  try {
    return atob(padded)
  } catch (cause) {
    throw new InvalidCursorError("payload is not base64url", { cause })
  }
}

/** A fresh watermark cursor: "deposits created after this instant". */
export function newWatermarkCursor(afterCreatedAtMs: number): string {
  return encodeCursor({ afterCreatedAtMs, boundary: null })
}

/**
 * Keeps the original creation watermark and adds the last returned row as the
 * exclusive boundary for the next descending page.
 */
export function newContinuationCursor(cursor: DepositCursor, boundary: PageBoundary): string {
  return encodeCursor({ afterCreatedAtMs: cursor.afterCreatedAtMs, boundary })
}

// Not exported: the two constructors above are the only issuance paths, so
// every encoded cursor is complete by construction.
function encodeCursor(cursor: DepositCursor): string {
  const payload: CursorPayload = {}
  if (cursor.afterCreatedAtMs !== null) {
    payload.after_created_at = new Date(cursor.afterCreatedAtMs).toISOString()
  }
  if (cursor.boundary) {
    payload.before_observed_at = new Date(cursor.boundary.observedAtMs).toISOString()
    payload.before_created_at = new Date(cursor.boundary.createdAtMs).toISOString()
    payload.before_id = cursor.boundary.id
  }
  return CURSOR_PREFIX + base64UrlEncode(JSON.stringify(payload))
}

/**
 * Decodes both the creation watermark and the optional exclusive row boundary.
 * Throws an invalid-cursor error (see isInvalidCursorError) on any format
 * violation; handlers translate it to `400 "after is invalid"`.
 */
export function parseCursor(value: string): DepositCursor {
  const trimmed = value.trim()
  if (trimmed === "") throw new InvalidCursorError("cursor is empty")
  if (trimmed.length > MAX_CURSOR_LENGTH) {
    throw new InvalidCursorError("cursor exceeds maximum length")
  }
  if (!trimmed.startsWith(CURSOR_PREFIX)) {
    throw new InvalidCursorError("cursor version is unsupported")
  }
  const decoded = base64UrlDecode(trimmed.slice(CURSOR_PREFIX.length))

  // The first v1 implementation encoded the bare RFC 3339 timestamp instead
  // of a JSON object; the backend still accepts those, so the mock does too.
  if (RFC3339_PATTERN.test(decoded)) {
    return { afterCreatedAtMs: parseCursorTime(decoded, "after_created_at"), boundary: null }
  }

  let payload: CursorPayload
  try {
    payload = JSON.parse(decoded) as CursorPayload
  } catch (cause) {
    throw new InvalidCursorError("payload is not valid cursor JSON", { cause })
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new InvalidCursorError("payload is not valid cursor JSON")
  }
  for (const key of Object.keys(payload)) {
    if (!PAYLOAD_KEYS.includes(key)) throw new InvalidCursorError(`unknown payload key: ${key}`)
  }

  const afterCreatedAtMs = payload.after_created_at
    ? parseCursorTime(payload.after_created_at, "after_created_at")
    : null

  const { before_observed_at, before_created_at } = payload
  const beforeId = (payload.before_id ?? "").trim()
  if (!before_observed_at && !before_created_at && !beforeId) {
    if (afterCreatedAtMs === null) {
      throw new InvalidCursorError("payload has no watermark or page boundary")
    }
    return { afterCreatedAtMs, boundary: null }
  }
  // A complete page boundary is valid without a creation watermark: deposit
  // lists that start without `after` still need a usable next_cursor.
  if (!before_observed_at || !before_created_at || !beforeId) {
    throw new InvalidCursorError("page boundary is incomplete")
  }
  if (!isCanonicalUuid(beforeId)) {
    throw new InvalidCursorError("before_id is not a canonical UUID")
  }
  return {
    afterCreatedAtMs,
    boundary: {
      observedAtMs: parseCursorTime(before_observed_at, "before_observed_at"),
      createdAtMs: parseCursorTime(before_created_at, "before_created_at"),
      id: beforeId,
    },
  }
}

function parseCursorTime(value: string, field: string): number {
  if (!RFC3339_PATTERN.test(value)) throw new InvalidCursorError(`${field} is invalid`)
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new InvalidCursorError(`${field} is invalid`)
  return parsed
}

function isCanonicalUuid(value: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)
}
