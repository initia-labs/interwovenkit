import type { NormalizedChain } from "./chains"
import { resolveEnabledChainState } from "./chains"

describe("resolveEnabledChainState", () => {
  it("returns the query error when the registry fails before any data is cached", () => {
    const error = new Error("Failed to load chains")

    expect(
      resolveEnabledChainState({
        chainId: "initiation-1",
        chains: undefined,
        enabled: true,
        error,
        isLoading: false,
      }),
    ).toEqual({
      chain: undefined,
      error,
      isLoading: false,
    })
  })

  it("returns the cached chain even if a background refetch fails", () => {
    const chain = { chain_id: "initiation-1" } as NormalizedChain

    expect(
      resolveEnabledChainState({
        chainId: chain.chain_id,
        chains: [chain],
        enabled: true,
        error: new Error("background refetch failed"),
        isLoading: false,
      }),
    ).toEqual({
      chain,
      error: null,
      isLoading: false,
    })
  })
})
