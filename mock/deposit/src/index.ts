// Deposit API mock server. Read-only endpoints pass through to the real
// API; deposits and checkout are simulated in memory so the full deposit flow
// can be exercised without real funds. See mock/README.md and mock/DESIGN.md.

import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { registerCheckoutRoutes } from "./checkout.ts"
import { registerControlRoutes } from "./control.ts"
import { registerDepositRoutes } from "./deposits.ts"
import { handleAssets } from "./fakeAssets.ts"
import { injectionMiddleware } from "./injection.ts"
import { handleDepositAddress, passthrough, UPSTREAM_URL } from "./proxy.ts"
import { getConfig } from "./state.ts"

const app = new Hono()

// The upstream's CORS surface, plus PATCH for the control API (a devtool-only
// extension — the widget never sends it, so the real contract is not skewed).
app.use(
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "X-Correlation-ID", "X-Request-ID"],
  }),
)
app.use(injectionMiddleware(getConfig))

registerControlRoutes(app)

// Free read-only endpoints proxy to the real API; only the endpoints that
// need real funds (checkout) or real-fund data (deposits) are simulated.
// Assets optionally gain a fake source network for selector-UI testing.
app.get("/v1/config/assets", handleAssets)
app.get("/v1/quote", passthrough)
app.post("/v1/deposit-address", handleDepositAddress)

registerDepositRoutes(app)
registerCheckoutRoutes(app)

app.notFound((c) => c.json({ error: "not found" }, 404))
app.onError((error, c) => {
  console.error("unhandled error", c.req.method, c.req.path, error)
  return c.json({ error: "internal error" }, 500)
})

const port = Number(process.env.PORT ?? 8788)
serve({ fetch: app.fetch, port }, () => {
  console.log(`Deposit mock listening on http://localhost:${port} (upstream: ${UPSTREAM_URL})`)
})
