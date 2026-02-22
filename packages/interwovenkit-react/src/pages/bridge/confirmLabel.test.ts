import { getBridgeConfirmLabel } from "./confirmLabel"

describe("getBridgeConfirmLabel", () => {
  it("uses reconfirm label even when a custom confirm message is provided", () => {
    expect(getBridgeConfirmLabel("Deposit", true)).toBe("Confirm updated route")
    expect(getBridgeConfirmLabel("Withdraw", true)).toBe("Confirm updated route")
  })

  it("uses custom confirm message when reconfirm is not required", () => {
    expect(getBridgeConfirmLabel("Deposit", false)).toBe("Deposit")
  })

  it("falls back to default confirm when custom message is not provided", () => {
    expect(getBridgeConfirmLabel(undefined, false)).toBe("Confirm")
  })
})
