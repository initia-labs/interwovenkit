import { describe, it, expect } from "vitest"
import { getCoinChanges } from "./changes"
import wasmTx from "./wasm.json"
import evmTx from "./evm.json"

describe("getCoinChanges", () => {
  describe("wasm", () => {
    it("should return negative amount for sender", () => {
      const sender = "init1veaum7vy45fzw5x4mflskgx5lnmwmxx5wm3x8p"
      const result = getCoinChanges(wasmTx.events, sender)

      expect(result).toEqual([
        {
          amount: "-1000000",
          denom: "l2/c88b68df2060ba982a80d3001afcb2d354031f6901df2391acb4f0e2f545c770",
        },
      ])
    })

    it("should return positive amount for recipient", () => {
      const recipient = "init1yh03a2wr9f5sr9ln0nlpgpwah7gqurccy33y0h"
      const result = getCoinChanges(wasmTx.events, recipient)

      expect(result).toEqual([
        {
          amount: "1000000",
          denom: "l2/c88b68df2060ba982a80d3001afcb2d354031f6901df2391acb4f0e2f545c770",
        },
      ])
    })
  })

  describe("evm", () => {
    it("should return negative amount for sender", () => {
      const sender = "init1veaum7vy45fzw5x4mflskgx5lnmwmxx5wm3x8p"
      const result = getCoinChanges(evmTx.events, sender)

      expect(result).toEqual([
        {
          amount: "-1000000000000000000",
          denom: "evm/4f7566f67941283a30cf65de7b9c6fdf2c04FCA1",
        },
      ])
    })

    it("should return positive amount for recipient", () => {
      const recipient = "init1yh03a2wr9f5sr9ln0nlpgpwah7gqurccy33y0h"
      const result = getCoinChanges(evmTx.events, recipient)

      expect(result).toEqual([
        {
          amount: "1000000000000000000",
          denom: "evm/4f7566f67941283a30cf65de7b9c6fdf2c04FCA1",
        },
      ])
    })
  })
})
