import { HTTPError } from "ky"
import { includes, path } from "ramda"

export const STALE_TIMES = {
  SECOND: 1000,
  MINUTE: 1000 * 60,
  INFINITY: /* HOUR, just in case */ 1000 * 60 * 60,
} as const

export async function normalizeError(error: unknown): Promise<Error> {
  if (error instanceof HTTPError) {
    const { response } = error
    const contentType = response.headers.get("content-type") ?? ""

    if (includes("application/json", contentType)) {
      try {
        const data = await response.json()
        if (data.message) return data.message
      } catch {
        return new Error(error.message)
      }
    }

    try {
      return new Error(await response.text())
    } catch {
      return new Error(error.message)
    }
  }

  if (error instanceof Error) {
    if (path(["code"], error) === 4001) return new Error("User rejected")
    if (path(["code"], error) === "ACTION_REJECTED") return new Error("User rejected")
    const errorMessage = path<string>(["error", "message"], error)
    const causeMessage = path<string>(["cause", "message"], error)
    const shortMessage = path<string>(["shortMessage"], error)
    if (errorMessage) return new Error(errorMessage)
    if (causeMessage) return new Error(causeMessage)
    if (shortMessage) return new Error(shortMessage)
    return new Error(error.message)
  }

  return new Error(String(error))
}
