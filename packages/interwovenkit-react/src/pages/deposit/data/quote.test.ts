import { describe, expect, it } from "vitest"
import { createQuoteQueryOptions, parseQuoteDelivery } from "./quote"
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

describe("createQuoteQueryOptions", () => {
  it("sends the route identity and normalizes the delivery prediction", async () => {
    const quote = { amount_out: "9900000", min_received: "9850000" }
    const { api, calls } = stubApi({
      ...quote,
      delivery: { method: "advance", estimated_seconds: "60" },
    })
    await expect(runQueryFn(createQuoteQueryOptions(api, PARAMS, true))).resolves.toEqual({
      status: "quoted",
      quote: { ...quote, delivery: { method: "advance", estimated_seconds: null } },
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

  // The submit gate keys on a decline: a 400 leaking into the error channel loses the minimum gate.
  it.each([
    [
      "declines a 400 with the backend's reason",
      httpError(400, { message: "route paused" }),
      { status: "declined", reason: "route paused" },
    ],
    ["rejects a server error", httpError(500, { message: "boom" }), { message: "boom" }],
    ["rejects a network failure", new Error("network down"), { message: "network down" }],
  ])("%s", async (_name, failure, expected) => {
    const outcome = await runQueryFn(
      createQuoteQueryOptions(stubApi(failure).api, PARAMS, true),
    ).catch((error: unknown) => error)
    expect(outcome).toMatchObject(expected)
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
    [
      "nulls a negative estimate",
      { method: "standard", estimated_seconds: -1 },
      { method: "standard", estimated_seconds: null },
    ],
    ["drops a missing method", { estimated_seconds: 60 }, undefined],
    ["drops an empty method", { method: "", estimated_seconds: 60 }, undefined],
    ["drops an absent prediction", undefined, undefined],
  ])("%s", (_, input, expected) => {
    expect(parseQuoteDelivery(input)).toEqual(expected)
  })
})
