// Delay/error injection for business responses. The control prefix is exempt
// so the control API stays usable while failures are being simulated.
// Order: delay first, then the error roll — an injected error on a proxy
// endpoint short-circuits before any real upstream call.

import type { MiddlewareHandler } from "hono"

export interface InjectionConfig {
  responseDelayMs: number
  errorRate: number
}

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
