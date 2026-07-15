import { HTTPError, type NormalizedOptions } from "ky"
import { describe, expect, it } from "vitest"
import {
  classifyQuoteFailure,
  composeMinReceived,
  deriveSettlement,
  selectMinReceived,
} from "./minReceived"

const httpError = (status: number, body?: object) =>
  new HTTPError(
    new Response(body ? JSON.stringify(body) : null, {
      status,
      headers: body ? { "content-type": "application/json" } : undefined,
    }),
    new Request("https://deposit.test/v1/quote"),
    {} as NormalizedOptions,
  )

describe("classifyQuoteFailure", () => {
  // The layer-4 submit gate keys on this: a 400 leaking into the error channel
  // silently loses the backend-signaled minimum gate (UI looks identical, "—").
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

const quoted = (minReceived: string) => ({
  status: "quoted" as const,
  quote: { amount_out: "0", min_received: minReceived },
})

describe("selectMinReceived", () => {
  it("formats a quoted minimum in token units", () => {
    expect(selectMinReceived(quoted("1000000"), 6, "123")).toEqual({
      value: "1.000000",
      isDeclined: false,
      declineReason: "",
    })
  })

  // keepPreviousData still holds the last estimate when the payout goes away;
  // the row must reset with the other quote-driven rows anyway.
  it("resets without a live payout even when previous data is held", () => {
    expect(selectMinReceived(quoted("1000000"), 6, "")).toEqual({
      value: "",
      isDeclined: false,
      declineReason: "",
    })
  })

  it("reports a decline with the backend's reason", () => {
    expect(selectMinReceived({ status: "declined", reason: "below minimum" }, 6, "123")).toEqual({
      value: "",
      isDeclined: true,
      declineReason: "below minimum",
    })
  })

  // "—" means "unknown"; "0" would claim a guaranteed minimum of zero.
  it("falls back to the placeholder for a zero minimum", () => {
    expect(selectMinReceived(quoted("0"), 6, "123").value).toBe("")
  })

  it("falls back to the placeholder for an unparseable minimum", () => {
    expect(selectMinReceived(quoted("not-a-number"), 6, "123").value).toBe("")
  })

  it("falls back to the placeholder without destination decimals", () => {
    expect(selectMinReceived(quoted("1000000"), undefined, "123").value).toBe("")
  })

  it("is empty before the first result arrives", () => {
    expect(selectMinReceived(undefined, 6, "123")).toEqual({
      value: "",
      isDeclined: false,
      declineReason: "",
    })
  })
})

describe("deriveSettlement", () => {
  it("settles vacuously when the query is disabled", () => {
    expect(
      deriveSettlement({
        enabled: false,
        hasData: false,
        isPlaceholderData: false,
        isError: false,
      }),
    ).toEqual({ isSettled: true, isFailed: false })
  })

  it("is pending on the first fetch", () => {
    expect(
      deriveSettlement({ enabled: true, hasData: false, isPlaceholderData: false, isError: false }),
    ).toEqual({ isSettled: false, isFailed: false })
  })

  it("is pending while the previous amount's result is served as placeholder", () => {
    expect(
      deriveSettlement({ enabled: true, hasData: true, isPlaceholderData: true, isError: false }),
    ).toEqual({ isSettled: false, isFailed: false })
  })

  it("settles once the current amount's result is in", () => {
    expect(
      deriveSettlement({ enabled: true, hasData: true, isPlaceholderData: false, isError: false }),
    ).toEqual({ isSettled: true, isFailed: false })
  })

  // A persistent transient-channel outage (5xx, network) must surface as a
  // failure, not "Getting quote…" forever.
  it("fails when retries exhaust with nothing usable for this amount", () => {
    expect(
      deriveSettlement({ enabled: true, hasData: false, isPlaceholderData: false, isError: true }),
    ).toEqual({ isSettled: false, isFailed: true })
  })

  it("fails when only the previous amount's placeholder is held", () => {
    expect(
      deriveSettlement({ enabled: true, hasData: true, isPlaceholderData: true, isError: true }),
    ).toEqual({ isSettled: false, isFailed: true })
  })

  // A failed background refresh of an already-settled verdict is not a
  // failure: the verdict is at most one interval stale and still usable.
  it("stays settled when a background refresh fails", () => {
    expect(
      deriveSettlement({ enabled: true, hasData: true, isPlaceholderData: false, isError: true }),
    ).toEqual({ isSettled: true, isFailed: false })
  })

  // React Query preserves isError after the query is disabled (the user
  // cleared the amount after an outage); other gates own disabled states, so
  // "Quote unavailable" must not resurrect on an empty amount field.
  it("settles vacuously when disabled even with a lingering error", () => {
    expect(
      deriveSettlement({ enabled: false, hasData: false, isPlaceholderData: false, isError: true }),
    ).toEqual({ isSettled: true, isFailed: false })
  })
})

describe("composeMinReceived", () => {
  const declined = { value: "", isDeclined: true, declineReason: "below minimum" }
  const estimate = { value: "1.000000", isDeclined: false, declineReason: "" }

  it("passes a settled result through", () => {
    const settlement = { isSettled: true, isFailed: false }
    expect(composeMinReceived(declined, settlement)).toEqual({ ...declined, ...settlement })
    expect(composeMinReceived(estimate, settlement)).toEqual({ ...estimate, ...settlement })
  })

  // keepPreviousData holds the previous amount's decline while the current
  // amount is in flight; its reason belongs to an amount the user already
  // changed, so it must not gate or caption the footer.
  it("suppresses a stale decline while the verdict is unsettled", () => {
    expect(composeMinReceived(declined, { isSettled: false, isFailed: false })).toEqual({
      value: "",
      isDeclined: false,
      declineReason: "",
      isSettled: false,
      isFailed: false,
    })
  })

  // The exact masking bug: previous amount declined, current amount's fetch
  // failing — the footer must show the failure, not the stale decline reason.
  it("prefers the failure over a stale decline", () => {
    expect(composeMinReceived(declined, { isSettled: false, isFailed: true })).toEqual({
      value: "",
      isDeclined: false,
      declineReason: "",
      isSettled: false,
      isFailed: true,
    })
  })

  // A normal refetch keeps the previous estimate on screen (flash
  // prevention); a failure drops it — a stale minimum next to a failure
  // notice would read as a live quote for an amount the backend never saw.
  it("keeps the previous estimate through a refetch but not through a failure", () => {
    expect(composeMinReceived(estimate, { isSettled: false, isFailed: false }).value).toBe(
      "1.000000",
    )
    expect(composeMinReceived(estimate, { isSettled: false, isFailed: true }).value).toBe("")
  })
})
