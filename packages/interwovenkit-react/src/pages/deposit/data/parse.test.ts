import { describe, expect, it } from "vitest"
import { gteInteger, ParseError, userErrorMessage } from "./parse"

describe("gteInteger", () => {
  it.each<[string | undefined, string, boolean]>([
    ["1000000", "1000000", true],
    ["1000001", "1000000", true],
    ["999999", "1000000", false],
    [undefined, "1", false],
    ["", "1000000", false],
    ["1.5", "1", false],
    ["2", "1.5", false],
  ])("%o >= %o is %s, failing closed on malformed input", (value, minimum, expected) => {
    expect(gteInteger(value, minimum)).toBe(expected)
  })
})

describe("userErrorMessage", () => {
  it.each<[Error | null, string | undefined]>([
    [
      new ParseError("Bridge quote response src_denom 0xabc is not 0xdef"),
      "Couldn't verify the route details. Try again.",
    ],
    [new Error("route paused"), "route paused"],
    [null, undefined],
  ])("shows %o as %o", (error, expected) => {
    expect(userErrorMessage(error)).toBe(expected)
  })
})
