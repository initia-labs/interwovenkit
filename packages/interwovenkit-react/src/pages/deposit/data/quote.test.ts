import { describe, expect, it } from "vitest"
import {
  classifyQuoteFailure,
  createQuoteQueryOptions,
  fetchQuote,
  QUOTE_STALE_TIME,
} from "./quote"
import { ETHEREUM_USDC, httpError, stubApi } from "./testing"

const PARAMS = {
  srcChainId: "1",
  srcDenom: ETHEREUM_USDC,
  dstChainId: "interwoven-1",
  dstDenom: "uusdc",
  amountIn: "10000000",
}

// The layer-4 submit gate keys on this: a 400 leaking into the error channel
// silently loses the backend-signaled minimum gate (the UI looks identical, "—").
describe("classifyQuoteFailure", () => {
  it("promotes a 400 to declined, keeping the backend's message", async () => {
    await expect(
      classifyQuoteFailure(httpError(400, { message: "amount below minimum" })),
    ).resolves.toEqual({ status: "declined", reason: "amount below minimum" })
  })

  it("rethrows server errors as transient failures", async () => {
    await expect(classifyQuoteFailure(httpError(500))).rejects.toThrow()
  })

  it("rethrows non-HTTP failures as transient failures", async () => {
    await expect(classifyQuoteFailure(new Error("network down"))).rejects.toThrow("network down")
  })
})

describe("fetchQuote", () => {
  it("sends the route identity as relative-path search params", async () => {
    const { api, calls } = stubApi({ amount_out: "1", min_received: "1" })
    await fetchQuote(api, PARAMS)
    expect(calls).toHaveLength(1)
    // No leading slash: the ky instance carries the prefixUrl.
    expect(calls[0].url).toBe("v1/quote")
    expect(calls[0].options?.searchParams).toEqual({
      src_chain_id: "1",
      src_denom: ETHEREUM_USDC,
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

  it("routes a failure through classifyQuoteFailure rather than the error channel", async () => {
    const { api } = stubApi(httpError(400, { message: "amount below minimum" }))
    await expect(fetchQuote(api, PARAMS)).resolves.toEqual({
      status: "declined",
      reason: "amount below minimum",
    })
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
      ETHEREUM_USDC,
      "interwoven-1",
      "uusdc",
      "10000000",
    ])
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
