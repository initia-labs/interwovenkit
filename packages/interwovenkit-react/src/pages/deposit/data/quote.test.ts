import type { KyInstance } from "ky"
import { HTTPError, type NormalizedOptions } from "ky"
import { describe, expect, it } from "vitest"
import { createQuoteQueryOptions, fetchQuote, QUOTE_STALE_TIME } from "./quote"

const httpError = (status: number, body?: object) =>
  new HTTPError(
    new Response(body ? JSON.stringify(body) : null, {
      status,
      headers: body ? { "content-type": "application/json" } : undefined,
    }),
    new Request("https://deposit.test/v1/quote"),
    {} as NormalizedOptions,
  )

interface Call {
  url: string
  options?: { searchParams?: Record<string, string> }
}

function stubApi(result: unknown | Error) {
  const calls: Call[] = []
  const api = {
    get: (url: string, options?: Call["options"]) => {
      calls.push({ url, options })
      return {
        json: () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)),
      }
    },
  } as unknown as KyInstance
  return { api, calls }
}

const PARAMS = {
  srcChainId: "1",
  srcDenom: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  dstChainId: "interwoven-1",
  dstDenom: "uusdc",
  amountIn: "10000000",
}

describe("fetchQuote", () => {
  it("sends the route identity as relative-path search params", async () => {
    const { api, calls } = stubApi({ amount_out: "1", min_received: "1" })
    await fetchQuote(api, PARAMS)
    expect(calls).toHaveLength(1)
    // No leading slash: the ky instance carries the prefixUrl.
    expect(calls[0].url).toBe("v1/quote")
    expect(calls[0].options?.searchParams).toEqual({
      src_chain_id: "1",
      src_denom: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      dst_chain_id: "interwoven-1",
      dst_denom: "uusdc",
      amount_in: "10000000",
    })
  })

  it("returns the quote on success", async () => {
    const quote = { amount_out: "9900000", min_received: "9850000" }
    const { api } = stubApi(quote)
    await expect(fetchQuote(api, PARAMS)).resolves.toEqual({ status: "quoted", quote })
  })

  // A decline leaking into the error channel would look like a transient outage
  // and silently drop the last minimum gate before a no-refund transfer.
  it("promotes a 400 to a decline carrying the backend's message", async () => {
    const { api } = stubApi(httpError(400, { message: "amount below minimum" }))
    await expect(fetchQuote(api, PARAMS)).resolves.toEqual({
      status: "declined",
      reason: "amount below minimum",
    })
  })

  it("rethrows other statuses as transient failures", async () => {
    const { api } = stubApi(httpError(503, { message: "unavailable" }))
    await expect(fetchQuote(api, PARAMS)).rejects.toThrow("unavailable")
  })
})

describe("createQuoteQueryOptions", () => {
  it("keys the query on the full route identity", () => {
    const { api } = stubApi({})
    const { queryKey } = createQuoteQueryOptions(api, PARAMS, true)
    expect(queryKey).toEqual([
      "interwovenkit:deposit",
      "minReceived",
      "1",
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      "interwoven-1",
      "uusdc",
      "10000000",
    ])
  })

  it("keeps a changed amount on a different cache entry", () => {
    const { api } = stubApi({})
    const a = createQuoteQueryOptions(api, PARAMS, true).queryKey
    const b = createQuoteQueryOptions(api, { ...PARAMS, amountIn: "20000000" }, true).queryKey
    expect(a).not.toEqual(b)
  })

  it("refreshes on the 30 s cadence and holds the previous estimate", () => {
    const { api } = stubApi({})
    const options = createQuoteQueryOptions(api, PARAMS, true)
    expect(QUOTE_STALE_TIME).toBe(30_000)
    expect(options.staleTime).toBe(QUOTE_STALE_TIME)
    expect(options.refetchInterval).toBe(QUOTE_STALE_TIME)
    expect(options.placeholderData).toBeTypeOf("function")
  })

  it("passes the caller's enabled gate through", () => {
    const { api } = stubApi({})
    expect(createQuoteQueryOptions(api, PARAMS, false).enabled).toBe(false)
    expect(createQuoteQueryOptions(api, PARAMS, true).enabled).toBe(true)
  })

  it("routes the queryFn through fetchQuote's decline classification", async () => {
    const { api } = stubApi(httpError(400, { message: "route paused" }))
    const { queryFn } = createQuoteQueryOptions(api, PARAMS, true)
    if (typeof queryFn !== "function") throw new Error("queryFn must be a function")
    await expect(queryFn({} as unknown as Parameters<typeof queryFn>[0])).resolves.toEqual({
      status: "declined",
      reason: "route paused",
    })
  })
})
