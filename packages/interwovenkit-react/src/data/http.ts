import { HTTPError } from "ky"
import { includes, path } from "ramda"

export const STALE_TIMES = {
  SECOND: 1000,
  MINUTE: 1000 * 60,
  INFINITY: /* HOUR, just in case */ 1000 * 60 * 60,
} as const

export async function normalizeError(error: unknown): Promise<string> {
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
    if (errorMessage) return errorMessage
    if (causeMessage) return causeMessage
    if (shortMessage) return shortMessage
    return error.message
  }

  return String(error)
}
