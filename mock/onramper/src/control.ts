// GET/PATCH /__mock/config: the only control surface this stateless proxy
// has (injection settings). Owns the config so the injection middleware and
// the handlers read the same instance.

import type { Hono } from "hono"
import type { InjectionConfig } from "./config.ts"
import { defaultConfig, validateConfigPatch } from "./config.ts"

let config: InjectionConfig = defaultConfig()

export const getConfig = (): InjectionConfig => config

export function registerControlRoutes(app: Hono): void {
  app.get("/__mock/config", (c) => c.json(config))

  app.patch("/__mock/config", async (c) => {
    const body = await c.req.json().catch(() => null)
    try {
      config = { ...config, ...validateConfigPatch(body) }
      return c.json(config)
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid config patch" }, 400)
    }
  })
}
