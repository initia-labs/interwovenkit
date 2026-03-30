import { describe, expect, it } from "vitest"
import { metadataToDenom } from "./assets"

describe("metadataToDenom", () => {
  it("converts a full-length metadata address", () => {
    expect(
      metadataToDenom("0x8009f4738c51127e82a2f298d4a687bb85e4138ceee150a4bd3b6e4735d666d1"),
    ).toBe("move/8009f4738c51127e82a2f298d4a687bb85e4138ceee150a4bd3b6e4735d666d1")
  })

  it("pads short metadata addresses to 64 hex chars", () => {
    expect(metadataToDenom("0x1")).toBe(
      "move/0000000000000000000000000000000000000000000000000000000000000001",
    )
  })

  it("converts a medium-length metadata address with leading zeros stripped", () => {
    expect(metadataToDenom("0x87e5481f8b5fe116ebc1c2b3ee523d86e3640e5f")).toBe(
      "move/00000000000000000000000087e5481f8b5fe116ebc1c2b3ee523d86e3640e5f",
    )
  })
})
