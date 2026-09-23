import { describe, expect, it } from "vitest"
import { classifyQuoteFailure, createQuoteQueryOptions, parseQuoteDelivery } from "./quote"
import { ETHEREUM_USDC_DENOM } from "./source"
import { httpError, runQueryFn, stubApi } from "./testing"
import type { QuoteDelivery } from "./types"

const PARAMS = {
  srcChainId: "1",
  srcDenom: ETHEREUM_USDC_DENOM,
  dstChainId: "interwoven-1",
  dstDenom: "uusdc",
  amountIn: "10000000",
}

// The submit gate keys on this: a 400 leaking into the error channel silently loses the backend's
// minimum gate.
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

describe("createQuoteQueryOptions", () => {
  it("sends the route identity and returns the quote", async () => {
    const quote = { amount_out: "9900000", min_received: "9850000" }
    const { api, calls } = stubApi(quote)
    await expect(runQueryFn(createQuoteQueryOptions(api, PARAMS, true))).resolves.toEqual({
      status: "quoted",
      quote,
    })
    expect(calls[0].url).toBe("v1/quote")
    expect(calls[0].options?.searchParams).toEqual({
      src_chain_id: "1",
      src_denom: ETHEREUM_USDC_DENOM,
      dst_chain_id: "interwoven-1",
      dst_denom: "uusdc",
      amount_in: "10000000",
    })
  })

  it("returns a 400 as a decline rather than an error", async () => {
    const { api } = stubApi(httpError(400, { message: "route paused" }))
    await expect(runQueryFn(createQuoteQueryOptions(api, PARAMS, true))).resolves.toEqual({
      status: "declined",
      reason: "route paused",
    })
  })
})

describe("parseQuoteDelivery", () => {
  it.each<[string, unknown, QuoteDelivery | undefined]>([
    [
      "keeps a prediction",
      { method: "advance", estimated_seconds: 60 },
      { method: "advance", estimated_seconds: 60 },
    ],
    [
      "keeps a null estimate",
      { method: "standard", estimated_seconds: null },
      { method: "standard", estimated_seconds: null },
    ],
    [
      "nulls a malformed estimate",
      { method: "standard", estimated_seconds: "60" },
      { method: "standard", estimated_seconds: null },
    ],
    ["drops a missing method", { estimated_seconds: 60 }, undefined],
    ["drops a non-string method", { method: null, estimated_seconds: 60 }, undefined],
    ["drops an absent prediction", undefined, undefined],
  ])("%s", (_, input, expected) => {
    expect(parseQuoteDelivery(input)).toEqual(expected)
  })
})
