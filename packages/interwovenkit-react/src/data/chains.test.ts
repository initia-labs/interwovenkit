import type { Chain } from "@initia/initia-registry-types"
import type { NormalizedChain } from "./chains"
import {
  chainQueryKeys,
  createInitiaRegistryQueryOptions,
  resolveEnabledChainState,
} from "./chains"

function createChain(chainId: string, prettyName = chainId): Chain {
  return {
    apis: {
      indexer: [{ address: `https://${chainId}.indexer.example.com` }],
      rest: [{ address: `https://${chainId}.rest.example.com` }],
      rpc: [{ address: `https://${chainId}.rpc.example.com` }],
    },
    bech32_prefix: "init",
    chain_id: chainId,
    chain_name: chainId,
    fees: { fee_tokens: [] },
    metadata: {},
    network_type: "testnet",
    pretty_name: prettyName,
  } as Chain
}

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

describe("createInitiaRegistryQueryOptions", () => {
  it("reuses one select path for custom-chain replacement and default sorting", () => {
    const customChain = createChain("initiation-2", "Custom chain")
    const options = createInitiaRegistryQueryOptions({
      customChain,
      defaultChainId: "initiation-2",
      registryUrl: "https://registry.example.com",
    })

    expect(options.queryKey).toEqual(chainQueryKeys.list("https://registry.example.com").queryKey)
    expect(
      options.select?.([
        createChain("initiation-1"),
        createChain("initiation-2", "Original chain"),
      ]),
    ).toMatchObject([
      { chainId: "initiation-2", name: "Custom chain" },
      { chainId: "initiation-1", name: "initiation-1" },
    ])
  })
})
