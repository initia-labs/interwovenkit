import { HTTPError } from "ky"
import { includes, path } from "ramda"

export const STALE_TIMES = {
  SECOND: 1000,
  MINUTE: 1000 * 60,
  INFINITY: /* HOUR, just in case */ 1000 * 60 * 60,
} as const

/** Callers that treat a refusal as provably not sent compare against this exact string. */
export const USER_REJECTED_MESSAGE = "User rejected"

// 5000 is WalletConnect's rejection code.
const USER_REJECTED_CODES = ["4001", "5000", "ACTION_REJECTED"]
// Explicit cancellations only: a false match lets a transfer that was sent be signed again.
const USER_REJECTED_PATTERNS = [
  /user (rejected|denied|cancell?ed)/i,
  /cancell?ed by (the )?user/i,
  /closed modal/i,
]
const NESTED_ERROR_PATHS = [
  ["cause"],
  ["info", "error"],
  ["error"],
  ["originalError"],
  ["data", "originalError"],
  ["details"],
]

function isUserRejection(error: unknown): boolean {
  const seen = new WeakSet<object>()
  const queue: unknown[] = [error]
  while (queue.length > 0) {
    const node = queue.shift()
    if (typeof node === "string") {
      if (USER_REJECTED_PATTERNS.some((pattern) => pattern.test(node))) return true
    } else if (typeof node === "object" && node !== null && !seen.has(node)) {
      seen.add(node)
      // ethers reports a request already open in the wallet as ACTION_REJECTED "pending": not a refusal.
      if (path(["code"], node) === "ACTION_REJECTED" && path(["reason"], node) === "pending") {
        return false
      }
      if (USER_REJECTED_CODES.includes(String(path(["code"], node)))) return true
      queue.push(path(["message"], node), ...NESTED_ERROR_PATHS.map((key) => path(key, node)))
    }
  }
  return false
}

export async function normalizeErrorMessage(error: unknown): Promise<string> {
  if (error instanceof HTTPError) {
    const { response } = error
    const contentType = response.headers.get("content-type") ?? ""

    if (includes("application/json", contentType)) {
      try {
        const data = await response.json()
        if (data.message) return data.message
      } catch {
        return error.message
      }
    }

    try {
      return await response.text()
    } catch {
      return error.message
    }
  }

  if (isUserRejection(error)) return USER_REJECTED_MESSAGE

  if (error instanceof Error) {
    const errorMessage = path<string>(["error", "message"], error)
    const causeMessage = path<string>(["cause", "message"], error)
    const shortMessage = path<string>(["shortMessage"], error)
    const message = errorMessage || causeMessage || shortMessage || error.message
    if (message === PRIVY_POPUP_BLOCKED_MESSAGE) return POPUP_BLOCKED_MESSAGE
    return message
  }

  return String(error)
}

// `@privy-io/cross-app-connect` throws this when `window.open()` returns null, i.e. the
// browser blocked the wallet popup (popup blocker, or the click's user activation expired
// before the request reached the wallet). The raw text gives users nothing to act on.
const PRIVY_POPUP_BLOCKED_MESSAGE = "Failed to initialize request"
export const POPUP_BLOCKED_MESSAGE =
  "The wallet popup was blocked by the browser. Allow pop-ups for this site and try again."

export async function normalizeError(error: unknown): Promise<Error> {
  return new Error(await normalizeErrorMessage(error), { cause: error })
}
