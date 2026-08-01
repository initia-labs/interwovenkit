// Delay/error injection for proxied responses. Duplicates the deposit mock's;
// extract to a shared workspace if more code converges.

import type { MiddlewareHandler } from "hono"
import type { InjectionConfig } from "./config.ts"

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export function injectionMiddleware(getInjection: () => InjectionConfig): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.path.startsWith("/__mock")) return next()
    const { responseDelayMs, errorRate } = getInjection()
    if (responseDelayMs > 0) await sleep(responseDelayMs)
    if (errorRate > 0 && Math.random() < errorRate) {
      return c.json({ error: "injected error" }, 500)
    }
    return next()
  }
}
