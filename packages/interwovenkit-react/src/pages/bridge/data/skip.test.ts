import { skipQueryKeys } from "./skip"

describe("skipQueryKeys.route", () => {
  const baseValues = {
    srcChainId: "interwoven-1",
    srcDenom: "uinit",
    dstChainId: "interwoven-1",
    dstDenom: "ibc/abc",
    quantity: "1.5",
  }

  const findQuantity = (queryKey: readonly unknown[]): string | undefined => {
    for (const entry of queryKey) {
      if (entry && typeof entry === "object" && "quantity" in entry) {
        return (entry as { quantity: string }).quantity
      }
    }
    return undefined
  }

  it("normalizes a valid quantity through BigNumber", () => {
    expect(findQuantity(skipQueryKeys.route(baseValues).queryKey)).toBe("1.5")
  })

  // queryKey is evaluated every render regardless of `enabled`, so mid-typing
  // quantities like "." must not throw under BigNumber strict mode (v10+).
  it("normalizes a bare decimal point to zero", () => {
    expect(findQuantity(skipQueryKeys.route({ ...baseValues, quantity: "." }).queryKey)).toBe("0")
  })

  it("normalizes non-numeric strings to zero", () => {
    expect(findQuantity(skipQueryKeys.route({ ...baseValues, quantity: "abc" }).queryKey)).toBe("0")
  })

  it("normalizes an empty quantity to zero", () => {
    expect(findQuantity(skipQueryKeys.route({ ...baseValues, quantity: "" }).queryKey)).toBe("0")
  })
})
