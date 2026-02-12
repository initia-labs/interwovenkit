import type { NormalizedAsset } from "./assets"
import { findAssetByCounterpartyDenom } from "./assets"
import type { NormalizedChain } from "./chains"

describe("findAssetByCounterpartyDenom", () => {
  const currentChain = {
    chain_id: "target-rollup-1",
    chain_name: "target-rollup",
  } as NormalizedChain

  it("ignores traces from unrelated chains when searching fallback denom", () => {
    const denom = "l2/shared-denom"
    const unrelatedAsset = {
      denom: "evm/wrong",
      symbol: "WRONG",
      decimals: 6,
      logoUrl: "",
      traces: [
        {
          counterparty: {
            base_denom: denom,
            chain_name: "other-rollup",
            chain_id: "other-rollup-1",
          },
        },
        {
          counterparty: {
            base_denom: "uwrong",
            chain_name: "initia",
            chain_id: "interwoven-1",
          },
        },
      ],
    } as NormalizedAsset

    const relatedAsset = {
      denom: "evm/correct",
      symbol: "CORRECT",
      decimals: 6,
      logoUrl: "",
      traces: [
        {
          counterparty: {
            base_denom: denom,
            chain_name: "target-rollup",
            chain_id: "target-rollup-1",
          },
        },
        {
          counterparty: {
            base_denom: "ucorrect",
            chain_name: "initia",
            chain_id: "interwoven-1",
          },
        },
      ],
    } as NormalizedAsset

    const asset = findAssetByCounterpartyDenom(
      [unrelatedAsset, relatedAsset],
      currentChain,
      denom,
    )

    expect(asset?.denom).toBe("evm/correct")
  })

  it("returns undefined when only unrelated chains match", () => {
    const asset = findAssetByCounterpartyDenom(
      [
        {
          denom: "evm/only-unrelated",
          symbol: "UNRELATED",
          decimals: 6,
          logoUrl: "",
          traces: [
            {
              counterparty: {
                base_denom: "ibc/unrelated",
                chain_name: "another-rollup",
                chain_id: "another-rollup-1",
              },
            },
          ],
        } as NormalizedAsset,
      ],
      currentChain,
      "ibc/unrelated",
    )

    expect(asset).toBeUndefined()
  })
})
