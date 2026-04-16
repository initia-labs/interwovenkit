import type { TxJson } from "@skip-go/client"
import type { KyInstance } from "ky"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { QueryClient } from "@tanstack/react-query"
import type { useFindChain } from "@/data/chains"
import type {
  OfflineSigner,
  useAminoConverters,
  useAminoTypes,
  useCreateSigningStargateClient,
} from "@/data/signer"
import type { useFindChainType, useFindSkipChain } from "./chains"
import { prefetchBridgeRoutePreparation } from "./preparedRoute"
import type { RouterRouteResponseJson } from "./simulate"

function createRoute(overrides?: Partial<RouterRouteResponseJson>): RouterRouteResponseJson {
  return {
    amount_in: "10",
    amount_out: "9",
    dest_asset_chain_id: "initia-2",
    dest_asset_denom: "uinit",
    operations: [],
    required_chain_addresses: ["initia-1", "initia-2"],
    source_asset_chain_id: "initia-1",
    source_asset_denom: "uinit",
    ...overrides,
  } as RouterRouteResponseJson
}

function createCosmosTx(): TxJson {
  return {
    cosmos_tx: {
      msgs: [
        {
          msg: {},
          msg_type_url: "/cosmos.bank.v1beta1.MsgSend",
        },
      ],
    },
  } as TxJson
}

describe("prefetchBridgeRoutePreparation", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("prefetches only the address list when required_op_hook is set without signedOpHook", async () => {
    const fetchQuery = vi.fn().mockResolvedValueOnce(["init1addr"])
    const queryClient = { fetchQuery } as unknown as QueryClient
    const skip = {} as KyInstance
    const findSkipChain = vi.fn() as unknown as ReturnType<typeof useFindSkipChain>
    const findChainType = vi.fn(() => "initia") as unknown as ReturnType<typeof useFindChainType>

    await prefetchBridgeRoutePreparation({
      queryClient,
      skip,
      route: createRoute({
        required_op_hook: true,
      }),
      values: {
        srcChainId: "initia-1",
        dstChainId: "initia-2",
        sender: "init1s",
        recipient: "init1r",
        slippagePercent: "1",
        srcDenom: "uinit",
      },
      initiaAddress: "init1i",
      hexAddress: "0x1",
      signer: {} as OfflineSigner,
      findSkipChain,
      findChainType,
      findChain: vi.fn() as unknown as ReturnType<typeof useFindChain>,
      aminoConverters: {} as ReturnType<typeof useAminoConverters>,
      aminoTypes: { fromAmino: vi.fn() } as unknown as ReturnType<typeof useAminoTypes>,
      createSigningStargateClient: vi.fn() as ReturnType<typeof useCreateSigningStargateClient>,
    })

    expect(fetchQuery).toHaveBeenCalledTimes(1)
  })

  it("waits for the exact-fee check before navigating on initia routes", async () => {
    const fetchQuery = vi
      .fn()
      .mockResolvedValueOnce(["init1addr"])
      .mockResolvedValueOnce(createCosmosTx())
      .mockResolvedValueOnce({ uinit: { amount: "1000" } })
      .mockResolvedValueOnce(true)
    const queryClient = { fetchQuery } as unknown as QueryClient
    const skip = {} as KyInstance
    const findSkipChain = vi.fn() as unknown as ReturnType<typeof useFindSkipChain>
    const findChainType = vi.fn(() => "initia") as unknown as ReturnType<typeof useFindChainType>
    const findChain = vi.fn(() => ({
      chain_id: "initia-1",
      chain_name: "Initia",
      pretty_name: "Initia",
      fees: { fee_tokens: [{ denom: "uinit" }] },
      bech32_prefix: "init",
      metadata: { is_l1: true },
      name: "Initia",
      logoUrl: "",
      rpcUrl: "https://rpc.example.com",
      restUrl: "https://lcd.example.com",
      indexerUrl: "https://indexer.example.com",
      jsonRpcUrl: undefined,
    })) as unknown as ReturnType<typeof useFindChain>

    await prefetchBridgeRoutePreparation({
      queryClient,
      skip,
      route: createRoute(),
      values: {
        srcChainId: "initia-1",
        dstChainId: "initia-2",
        sender: "init1s",
        recipient: "init1r",
        slippagePercent: "1",
        srcDenom: "uinit",
      },
      initiaAddress: "init1i",
      hexAddress: "0x1",
      signer: {} as OfflineSigner,
      findSkipChain,
      findChainType,
      findChain,
      aminoConverters: {} as ReturnType<typeof useAminoConverters>,
      aminoTypes: { fromAmino: vi.fn() } as unknown as ReturnType<typeof useAminoTypes>,
      createSigningStargateClient: vi.fn() as ReturnType<typeof useCreateSigningStargateClient>,
    })

    expect(fetchQuery).toHaveBeenCalledTimes(4)
  })
})
