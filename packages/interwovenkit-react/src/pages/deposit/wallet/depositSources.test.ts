import { describe, expect, it } from "vitest"
import { ETHEREUM_USDC_DENOM } from "../data/source"
import type { Asset } from "../data/types"
import {
  DEPOSIT_API_SOURCES,
  findDepositApiSource,
  getBridgeToolDisplay,
  intersectHostSources,
  resolveDepositTransport,
} from "./depositSources"
import { buildDestinationNetwork } from "./testing"

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const ARBITRUM_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
const EVM_IUSD = "0xAbCdEf0000000000000000000000000000000001"

const ethereumRoute = (overrides: Partial<Asset> = {}): Asset => ({
  src_chain_id: "1",
  src_denom: ETHEREUM_USDC_DENOM,
  src_decimals: 6,
  min_deposit_amount: "10000000",
  max_slippage_percent: "0.5",
  dst_symbol: "iUSD",
  dst_networks: [buildDestinationNetwork()],
  ...overrides,
})

describe("findDepositApiSource", () => {
  it.each([
    ["8453", BASE_USDC, "Base"],
    ["8453", BASE_USDC.toLowerCase(), "Base"],
    ["42161", ARBITRUM_USDC, "Arbitrum"],
    ["1", BASE_USDC, undefined],
    ["1", "ethereum-native", undefined],
    ["10", "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", undefined],
    ["42161", "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", undefined],
  ])("chain %s, denom %s → %s", (chainId, denom, chainName) => {
    expect(findDepositApiSource(chainId, denom)?.chainName).toBe(chainName)
  })
})

describe("resolveDepositTransport", () => {
  const route = ethereumRoute()
  const params = {
    mode: "deposit" as const,
    hasDepositApi: true,
    srcChainId: "8453",
    srcDenom: BASE_USDC,
    dstChainId: "interwoven-1",
    dstDenom: "uusdc",
    catalog: [route],
    catalogError: false,
  }
  const ethereum = { srcChainId: "1", srcDenom: ETHEREUM_USDC_DENOM }
  const outsideAllowlist = { srcChainId: "1", srcDenom: "ethereum-native" }

  it.each([
    ["Base", {}, "lifi", "Base"],
    ["Ethereum", ethereum, "direct", "Ethereum"],
    ["Base after a background refetch failed", { catalogError: true }, "lifi", "Base"],
    [
      "Ethereum after a background refetch failed",
      { ...ethereum, catalogError: true },
      "direct",
      "Ethereum",
    ],
  ])("resolves %s through the Ethereum route", (_, overrides, transport, chainName) => {
    expect(resolveDepositTransport({ ...params, ...overrides })).toMatchObject({
      transport,
      source: { chainName },
      route,
      destination: buildDestinationNetwork(),
    })
  })

  it.each([
    ["withdraw", { mode: "withdraw" as const }],
    [
      "withdraw while the catalog fails",
      { mode: "withdraw" as const, catalog: undefined, catalogError: true },
    ],
    ["no configured Deposit API", { hasDepositApi: false }],
    ["a source outside the allowlist", outsideAllowlist],
    [
      "a source outside the allowlist while the catalog loads",
      { ...outsideAllowlist, catalog: undefined },
    ],
    [
      "a source outside the allowlist while the catalog fails",
      { ...outsideAllowlist, catalog: undefined, catalogError: true },
    ],
    [
      "a catalog without the Ethereum USDC route",
      { catalog: [ethereumRoute({ src_denom: "other" })] },
    ],
    ["an empty catalog", { catalog: [] }],
    ["a destination chain the route does not feed", { dstChainId: "yominet-1" }],
    ["a destination denom the route does not feed", { dstDenom: "uinit" }],
    [
      "an unsupported destination vm_type",
      {
        catalog: [
          ethereumRoute({ dst_networks: [buildDestinationNetwork({ vm_type: "not_supported" })] }),
        ],
      },
    ],
  ])("keeps Router for %s", (_, overrides) => {
    expect(resolveDepositTransport({ ...params, ...overrides })).toEqual({ transport: "router" })
  })

  it.each([
    [false, "loading"],
    [true, "error"],
  ])("names the canonical source it holds back (catalogError %s → %s)", (catalogError, reason) => {
    expect(resolveDepositTransport({ ...params, catalog: undefined, catalogError })).toMatchObject({
      transport: "unavailable",
      reason,
      source: { chainName: "Base" },
    })
  })

  it("matches 0x route and destination denoms case-insensitively", () => {
    const catalog = [
      ethereumRoute({
        src_denom: ETHEREUM_USDC_DENOM.toLowerCase(),
        dst_networks: [
          buildDestinationNetwork({ chain_id: "evm-1", denom: EVM_IUSD, vm_type: "evm" }),
        ],
      }),
    ]
    expect(
      resolveDepositTransport({
        ...params,
        catalog,
        dstChainId: "evm-1",
        dstDenom: EVM_IUSD.toLowerCase(),
      }),
    ).toMatchObject({ transport: "lifi", destination: { denom: EVM_IUSD } })
  })
})

describe("intersectHostSources", () => {
  it.each([
    ["no allowlist keeps every source", [], ["Ethereum", "Base", "Arbitrum"]],
    ["a permitted pair", [{ chainId: "8453", denom: BASE_USDC.toLowerCase() }], ["Base"]],
    ["the right denom on another chain", [{ chainId: "1", denom: BASE_USDC }], []],
  ])("%s", (_, remoteOptions, chainNames) => {
    expect(
      intersectHostSources(DEPOSIT_API_SOURCES, remoteOptions).map(({ chainName }) => chainName),
    ).toEqual(chainNames)
  })
})

describe("getBridgeToolDisplay", () => {
  it.each(["brandNewBridge", "toString"])("keeps the unlisted key %s as the raw name", (key) => {
    expect(getBridgeToolDisplay(key)).toEqual({ name: key, logoUrl: "" })
  })
})
