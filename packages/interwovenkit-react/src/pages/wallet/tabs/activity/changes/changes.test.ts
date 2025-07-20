import { describe, it, expect } from "vitest"
import { getCoinChanges, getMoveChanges } from "./changes"
import moveTx from "./move.json"
import wasmTx from "./wasm.json"
import evmTx from "./evm.json"

describe("getCoinChanges", () => {
  describe("move", () => {
    it("should return changes", () => {
      const sender = "0x667BCDf984Ad122750d5Da7F0b20D4fCF6eD98d4"
      const result = getMoveChanges(moveTx.events, sender)

      expect(result).toEqual([
        {
          amount: "-100000",
          metadata: "0x47111f2a0a2e58e3ec0837938fe97b5cae5cf4872505d9c03e077422fea4b162",
        },
        {
          amount: "-168935",
          metadata: "0x8e4733bdabcf7d4afc3d14f0dd46c9bf52fb0fce9e4b996c939e195b8bc891d9",
        },
        {
          amount: "265227",
          metadata: "0x5ac318c3479d518f7b9baf80a9c9533475434b645316d266a12e66a349a9f2ae",
        },
      ])
    })
  })

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
