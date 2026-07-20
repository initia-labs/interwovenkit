import { describe, expect, it } from "vitest"
import { isSupportedVmType } from "./types"

describe("isSupportedVmType", () => {
  it("accepts the supported set", () => {
    expect(isSupportedVmType("move")).toBe(true)
    expect(isSupportedVmType("evm")).toBe(true)
    expect(isSupportedVmType("wasm")).toBe(true)
  })

  // The wire set is open ("not_supported" exists, new VMs can follow). An
  // unknown value must fail closed — hidden from the receive picker — instead
  // of rendering as a supported network.
  it("rejects not_supported and unknown values", () => {
    expect(isSupportedVmType("not_supported")).toBe(false)
    expect(isSupportedVmType("svm")).toBe(false)
    expect(isSupportedVmType("")).toBe(false)
  })
})
