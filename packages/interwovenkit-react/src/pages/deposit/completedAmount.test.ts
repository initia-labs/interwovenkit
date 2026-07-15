import { describe, expect, it } from "vitest"
import { formatCompletedAmount } from "./completedAmount"

const params = {
  amountOut: "1000000",
  sentAmount: "2000000000000000000",
  dstDecimals: 6,
  srcDecimals: 18,
  receiveSymbol: "iUSD",
  sentSymbol: "ETH",
}

describe("formatCompletedAmount", () => {
  it("prefers the router-quoted amount with the destination symbol", () => {
    expect(formatCompletedAmount(params)).toBe("1.000000 iUSD")
  })

  it("falls back to the sent amount with the SOURCE symbol when amount_out is absent", () => {
    expect(formatCompletedAmount({ ...params, amountOut: undefined })).toBe("2.000000 ETH")
  })

  // A zero or corrupt quote must never render "0 … was delivered": on a
  // successful delivery that reads as lost funds.
  it("falls back to the sent amount when amount_out is zero", () => {
    expect(formatCompletedAmount({ ...params, amountOut: "0" })).toBe("2.000000 ETH")
  })

  it("falls back to the sent amount when amount_out is unparseable", () => {
    expect(formatCompletedAmount({ ...params, amountOut: "not-a-number" })).toBe("2.000000 ETH")
  })

  it("falls back to the quoted amount path only with destination decimals", () => {
    expect(formatCompletedAmount({ ...params, dstDecimals: undefined })).toBe("2.000000 ETH")
  })

  it("uses the amount-less sentence when the route is gone from config/assets", () => {
    expect(
      formatCompletedAmount({ ...params, dstDecimals: undefined, srcDecimals: undefined }),
    ).toBe("Your iUSD")
  })

  it("uses the amount-less sentence when no deposit is loaded", () => {
    expect(
      formatCompletedAmount({
        ...params,
        amountOut: undefined,
        sentAmount: undefined,
      }),
    ).toBe("Your iUSD")
  })

  it("uses the amount-less sentence when the sent amount is unparseable", () => {
    expect(
      formatCompletedAmount({ ...params, amountOut: undefined, sentAmount: "not-a-number" }),
    ).toBe("Your iUSD")
  })
})
