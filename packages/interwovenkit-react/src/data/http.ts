import { HTTPError } from "ky"
import { includes, path } from "ramda"

export const STALE_TIMES = {
  SECOND: 1000,
  MINUTE: 1000 * 60,
  INFINITY: /* HOUR, just in case */ 1000 * 60 * 60,
} as const

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

  if (error instanceof Error) {
    if (path(["code"], error) === 4001) return "User rejected"
    if (path(["code"], error) === "ACTION_REJECTED") return "User rejected"
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
