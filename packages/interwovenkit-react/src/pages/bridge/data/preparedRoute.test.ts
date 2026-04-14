import type { TxJson } from "@skip-go/client"
import type { KyInstance } from "ky"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { QueryClient } from "@tanstack/react-query"
import type { OfflineSigner } from "@/data/signer"
import { getBridgeRoutePreparationState, prefetchBridgeRoutePreparation } from "./preparedRoute"
import type { RouterRouteResponseJson } from "./simulate"

function createRoute(overrides?: Partial<RouterRouteResponseJson>): RouterRouteResponseJson {
  return {
    amount_in: "10",
    amount_out: "9",
    dest_asset_chain_id: "initia-1",
    dest_asset_denom: "uinit",
    operations: [],
    source_asset_chain_id: "arb-1",
    source_asset_denom: "0xtoken",
    ...overrides,
  } as RouterRouteResponseJson
}

function createEvmTx(): TxJson {
  return {
    evm_tx: {
      chain_id: "42161",
      data: "0x",
      required_erc20_approvals: [
        {
          amount: "10",
          spender: "0xspender",
          token_contract: "0xtoken",
        },
      ],
      signer_address: "0xsigner",
      to: "0xrecipient",
      value: "0x0",
    },
  } as TxJson
}

describe("getBridgeRoutePreparationState", () => {
  it("waits for approval discovery before reporting the route as ready", () => {
    expect(
      getBridgeRoutePreparationState({
        addressList: ["0xsigner"],
        approvalError: null,
        balancesError: null,
        blockingError: null,
        exactFeeError: null,
        hasApprovalData: false,
        isCheckingApprovals: true,
        isCheckingFeeBalance: false,
        isLoadingAddressList: false,
        isLoadingTx: false,
        isRoutePreparingTx: false,
        requiresExactFeeCheck: false,
        route: createRoute(),
        tx: createEvmTx(),
      }),
    ).toEqual(
      expect.objectContaining({
        hasBlockingError: false,
        isPreparing: true,
        isReady: false,
      }),
    )
  })

  it("waits for exact-fee preparation before reporting the route as ready", () => {
    expect(
      getBridgeRoutePreparationState({
        addressList: ["0xsigner"],
        approvalError: null,
        balancesError: null,
        blockingError: null,
        exactFeeError: null,
        hasApprovalData: true,
        isCheckingApprovals: false,
        isCheckingFeeBalance: true,
        isLoadingAddressList: false,
        isLoadingTx: false,
        isRoutePreparingTx: false,
        requiresExactFeeCheck: true,
        route: createRoute(),
        tx: createEvmTx(),
      }),
    ).toEqual(
      expect.objectContaining({
        hasBlockingError: false,
        isPreparing: true,
        isReady: false,
      }),
    )
  })

  it("treats exact-fee failures as blocking preparation errors", () => {
    expect(
      getBridgeRoutePreparationState({
        addressList: ["0xsigner"],
        approvalError: null,
        balancesError: null,
        blockingError: null,
        exactFeeError: new Error("Fee check failed"),
        hasApprovalData: true,
        isCheckingApprovals: false,
        isCheckingFeeBalance: false,
        isLoadingAddressList: false,
        isLoadingTx: false,
        isRoutePreparingTx: false,
        requiresExactFeeCheck: true,
        route: createRoute(),
        tx: createEvmTx(),
      }),
    ).toEqual(
      expect.objectContaining({
        hasBlockingError: true,
        isReady: false,
      }),
    )
  })

  it("reports ready once address derivation, tx building, and approvals are done", () => {
    expect(
      getBridgeRoutePreparationState({
        addressList: ["0xsigner"],
        approvalError: null,
        balancesError: null,
        blockingError: null,
        exactFeeError: null,
        hasApprovalData: true,
        isCheckingApprovals: false,
        isCheckingFeeBalance: false,
        isLoadingAddressList: false,
        isLoadingTx: false,
        isRoutePreparingTx: false,
        requiresExactFeeCheck: false,
        route: createRoute(),
        tx: createEvmTx(),
      }),
    ).toEqual(
      expect.objectContaining({
        hasBlockingError: false,
        isPreparing: false,
        isReady: true,
      }),
    )
  })

  it("treats exact-fee balance loading failures as blocking preparation errors", () => {
    expect(
      getBridgeRoutePreparationState({
        addressList: ["0xsigner"],
        approvalError: null,
        balancesError: new Error("Failed to load balances"),
        blockingError: null,
        exactFeeError: null,
        hasApprovalData: true,
        isCheckingApprovals: false,
        isCheckingFeeBalance: false,
        isLoadingAddressList: false,
        isLoadingTx: false,
        isRoutePreparingTx: false,
        requiresExactFeeCheck: true,
        route: createRoute(),
        tx: createEvmTx(),
      }),
    ).toEqual(
      expect.objectContaining({
        hasBlockingError: true,
        isReady: false,
      }),
    )
  })
})

describe("prefetchBridgeRoutePreparation", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("prefetches only the address list when required_op_hook is set without signedOpHook", async () => {
    const fetchQuery = vi.fn().mockResolvedValueOnce(["init1addr"])
    const queryClient = { fetchQuery } as unknown as QueryClient
    const skip = {} as KyInstance

    await prefetchBridgeRoutePreparation({
      queryClient,
      skip,
      route: createRoute({
        required_op_hook: true,
        required_chain_addresses: ["initia-1", "initia-1"],
      }),
      values: {
        srcChainId: "a",
        dstChainId: "b",
        sender: "init1s",
        recipient: "init1r",
        slippagePercent: "1",
      },
      initiaAddress: "init1i",
      hexAddress: "0x1",
      signer: {} as OfflineSigner,
      findSkipChain: vi.fn(),
      findChainType: vi.fn(),
    })

    expect(fetchQuery).toHaveBeenCalledTimes(1)
  })
})
