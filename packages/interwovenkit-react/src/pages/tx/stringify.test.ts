import { fromBase64 } from "@cosmjs/encoding"
import { resolveBcsType } from "./stringify"

describe("resolveBcsType", () => {
  it("parses u8 values correctly", () => {
    const parse = (input: string) => resolveBcsType("u8").parse(fromBase64(input))

    expect(parse("AA==")).toBe(0)
    expect(parse("AQ==")).toBe(1)
    expect(parse("/w==")).toBe(255)
  })

  it("parses u64 values correctly", () => {
    const parse = (input: string) => resolveBcsType("u64").parse(fromBase64(input))

    expect(parse("AAAAAAAAAAA=")).toBe("0")
    expect(parse("oIYBAAAAAAA=")).toBe("100000")
    expect(parse("0gKWSQAAAAA=")).toBe("1234567890")
  })

  it("parses Move strings correctly", () => {
    const parse = (input: string) => resolveBcsType("0x1::string::String").parse(fromBase64(input))

    expect(parse("AA==")).toBe("")
    expect(parse("BkluaXRpYQ==")).toBe("Initia")
  })

  it("parses bool values correctly", () => {
    const parse = (input: string) => resolveBcsType("bool").parse(fromBase64(input))

    expect(parse("AQ==")).toBe(true)
    expect(parse("AA==")).toBe(false)
  })

  it("parses vector<u8> correctly", () => {
    const parse = (input: string) => resolveBcsType("vector<u8>").parse(fromBase64(input))

    expect(parse("AA==")).toEqual([])
    expect(parse("AwECAw==")).toEqual([1, 2, 3])
  })

  it("parses vector<String> correctly", () => {
    const parse = (input: string) =>
      resolveBcsType("vector<0x1::string::String>").parse(fromBase64(input))

    expect(parse("AgVIZWxsbwVXb3JsZA==")).toEqual(["Hello", "World"])
  })

  it("parses option<u8> correctly", () => {
    const parse = (input: string) => resolveBcsType("option<u8>").parse(fromBase64(input))

    expect(parse("AA==")).toBeNull()
    expect(parse("Af8=")).toBe(255)
  })

  it("parses 0x1::option::Option<u8> correctly", () => {
    const parse = (input: string) =>
      resolveBcsType("0x1::option::Option<u8>").parse(fromBase64(input))

    expect(parse("AA==")).toBeNull()
    expect(parse("Af8=")).toBe(255)
  })

  it("parses 0x1::object::Object<0x1::dex::Config> correctly", () => {
    const parse = (input: string) =>
      resolveBcsType("0x1::object::Object<0x1::dex::Config>").parse(fromBase64(input))

    expect(parse("VDs1o5z62tPaPCMknEdEVdFe/S+U+ElHMibe6KPHqeE=")).toBe(
      "0x543b35a39cfadad3da3c23249c474455d15efd2f94f849473226dee8a3c7a9e1",
    )
  })

  it("parses vector<0x1::option::Option<u64>> correctly", () => {
    const parse = (input: string) =>
      resolveBcsType("vector<0x1::option::Option<u64>>").parse(fromBase64(input))

    expect(parse("AgGLkgAAAAAAAAGQ9wAAAAAAAA==")).toEqual(["37515", "63376"])
  })

  it("parses bigdecimal values correctly", () => {
    const parse = (input: string) => resolveBcsType("bigdecimal").parse(fromBase64(input))

    expect(parse("AQo=")).toBe("0.00000000000000001")
    expect(parse("AQE=")).toBe("0.000000000000000001")
    expect(parse("D07zzP6X5NXzf+x01ha8AQ==")).toBe("9007199254740991.123456789012345678")
  })
})
