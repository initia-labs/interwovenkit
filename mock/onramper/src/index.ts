// Onramper mock: a stateless passthrough to the real Onramper API with
// delay/error injection. Every path is proxied (no endpoint whitelist), so the
// widget can add read-only calls without mock changes. Checkout is not handled
// here — it goes through the Deposit API proxy, so the deposit mock owns it.
// See mock/README.md and mock/DESIGN.md.

import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { getConfig, registerControlRoutes } from "./control.ts"
import { injectionMiddleware } from "./injection.ts"

const UPSTREAM_URL = (process.env.UPSTREAM_URL ?? "https://api.onramper.com").replace(/\/+$/, "")

const app = new Hono()

// Onramper's read endpoints are fully CORS-open; PATCH is a devtool-only
// extension for the control API.
app.use(
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type"],
  }),
)
app.use(injectionMiddleware(getConfig))

registerControlRoutes(app)

// Catch-all passthrough. The client's raw Authorization header (publishable
// key) is forwarded as-is; the mock never stores a key.
app.all("*", async (c) => {
  const url = new URL(c.req.url)
  const method = c.req.method
  const headers = new Headers()
  for (const name of ["authorization", "content-type", "accept"]) {
    const value = c.req.header(name)
    if (value) headers.set(name, value)
  }
  const body = method === "GET" || method === "HEAD" ? undefined : await c.req.arrayBuffer()
  try {
    const upstream = await fetch(UPSTREAM_URL + url.pathname + url.search, {
      method,
      headers,
      body,
    })
    const responseHeaders = new Headers()
    const contentType = upstream.headers.get("content-type")
    if (contentType) responseHeaders.set("content-type", contentType)
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders })
  } catch (error) {
    console.error("upstream request failed", url.pathname, error)
    return c.json({ error: "upstream request failed" }, 502)
  }
})

const port = Number(process.env.PORT ?? 8789)
serve({ fetch: app.fetch, port }, () => {
  console.log(`Onramper mock listening on http://localhost:${port} (upstream: ${UPSTREAM_URL})`)
})
