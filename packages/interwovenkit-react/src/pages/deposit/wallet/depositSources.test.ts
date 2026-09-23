import { describe, expect, it } from "vitest"
import { ETHEREUM_CHAIN_ID, ETHEREUM_USDC_DENOM } from "../data/source"
import type { Asset, DestinationNetwork } from "../data/types"
import {
  DEPOSIT_API_SOURCES,
  findDepositApiSource,
  getBridgeToolDisplay,
  intersectHostSources,
  resolveDepositTransport,
} from "./depositSources"

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const ARBITRUM_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"

const network = (overrides: Partial<DestinationNetwork> = {}): DestinationNetwork => ({
  chain_id: "interwoven-1",
  chain_name: "Initia",
  denom: "uusdc",
  decimals: 6,
  vm_type: "move",
  ...overrides,
})

const ethereumRoute = (overrides: Partial<Asset> = {}): Asset => ({
  src_chain_id: "1",
  src_denom: ETHEREUM_USDC_DENOM,
  src_decimals: 6,
  min_deposit_amount: "10000000",
  max_slippage_percent: "0.5",
  dst_symbol: "iUSD",
  dst_networks: [network()],
  ...overrides,
})

describe("findDepositApiSource", () => {
  it("matches a canonical pair, case-insensitively on the denom", () => {
    expect(findDepositApiSource("8453", BASE_USDC)?.chainName).toBe("Base")
    expect(findDepositApiSource("8453", BASE_USDC.toLowerCase())?.chainName).toBe("Base")
    expect(findDepositApiSource("42161", ARBITRUM_USDC)?.chainName).toBe("Arbitrum")
  })

  it("does not match the right denom on the wrong chain", () => {
    expect(findDepositApiSource("1", BASE_USDC)).toBeUndefined()
  })

  it("does not match native ETH, Optimism or Arbitrum USDC.e", () => {
    expect(findDepositApiSource("1", "ethereum-native")).toBeUndefined()
    expect(findDepositApiSource("10", "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85")).toBeUndefined()
    expect(
      findDepositApiSource("42161", "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8"),
    ).toBeUndefined()
  })
})

describe("resolveDepositTransport", () => {
  const params = {
    mode: "deposit" as const,
    hasDepositApi: true,
    srcChainId: "8453",
    srcDenom: BASE_USDC,
    dstChainId: "interwoven-1",
    dstDenom: "uusdc",
    catalog: [ethereumRoute()],
    catalogError: false,
  }

  it("resolves a Base source to the LI.FI transport with the Ethereum route", () => {
    const resolution = resolveDepositTransport(params)
    expect(resolution.transport).toBe("lifi")
    if (resolution.transport !== "lifi") throw new Error("expected lifi")
    expect(resolution.source.chainName).toBe("Base")
    expect(resolution.route.src_chain_id).toBe(ETHEREUM_CHAIN_ID)
    expect(resolution.destination.decimals).toBe(6)
  })

  it("resolves an Ethereum source to the direct transport", () => {
    const resolution = resolveDepositTransport({
      ...params,
      srcChainId: "1",
      srcDenom: ETHEREUM_USDC_DENOM,
    })
    expect(resolution.transport).toBe("direct")
  })

  it("keeps Router for withdraw and when no Deposit API is configured", () => {
    expect(resolveDepositTransport({ ...params, mode: "withdraw" }).transport).toBe("router")
    expect(resolveDepositTransport({ ...params, hasDepositApi: false }).transport).toBe("router")
  })

  it("keeps Router for a source outside the allowlist", () => {
    expect(
      resolveDepositTransport({ ...params, srcChainId: "1", srcDenom: "ethereum-native" })
        .transport,
    ).toBe("router")
  })

  it("reports the candidate sources unavailable while the catalog is unresolved", () => {
    const loading = resolveDepositTransport({ ...params, catalog: undefined })
    expect(loading).toMatchObject({ transport: "unavailable", reason: "loading" })
    const failed = resolveDepositTransport({
      ...params,
      catalog: undefined,
      catalogError: true,
    })
    expect(failed).toMatchObject({ transport: "unavailable", reason: "error" })
  })

  it("names the source it made unavailable so the UI can offer a retry", () => {
    const resolution = resolveDepositTransport({ ...params, catalog: undefined })
    if (resolution.transport !== "unavailable") throw new Error("expected unavailable")
    expect(resolution.source.chainName).toBe("Base")
  })

  it("keeps Router when the catalog has no Ethereum USDC route", () => {
    expect(
      resolveDepositTransport({ ...params, catalog: [ethereumRoute({ src_denom: "other" })] })
        .transport,
    ).toBe("router")
    expect(resolveDepositTransport({ ...params, catalog: [] }).transport).toBe("router")
  })

  it("keeps Router when the Ethereum route does not feed the destination", () => {
    expect(resolveDepositTransport({ ...params, dstChainId: "yominet-1" }).transport).toBe("router")
    expect(resolveDepositTransport({ ...params, dstDenom: "uinit" }).transport).toBe("router")
  })

  it("keeps Router when the destination network's vm_type is unsupported", () => {
    const unsupported = [ethereumRoute({ dst_networks: [network({ vm_type: "not_supported" })] })]
    expect(resolveDepositTransport({ ...params, catalog: unsupported }).transport).toBe("router")
  })

  it("matches the Ethereum route and destination denoms case-insensitively", () => {
    const lowercase = [ethereumRoute({ src_denom: ETHEREUM_USDC_DENOM.toLowerCase() })]
    expect(resolveDepositTransport({ ...params, catalog: lowercase }).transport).toBe("lifi")
  })
})

describe("intersectHostSources", () => {
  it("returns every source when the host set no allowlist", () => {
    expect(intersectHostSources(DEPOSIT_API_SOURCES, [])).toHaveLength(3)
  })

  it("keeps only the permitted pairs", () => {
    expect(
      intersectHostSources(DEPOSIT_API_SOURCES, [
        { chainId: "8453", denom: BASE_USDC.toLowerCase() },
      ]).map(({ chainName }) => chainName),
    ).toEqual(["Base"])
  })

  it("ignores an allowlist entry for a different chain", () => {
    expect(intersectHostSources(DEPOSIT_API_SOURCES, [{ chainId: "1", denom: BASE_USDC }])).toEqual(
      [],
    )
  })
})

describe("getBridgeToolDisplay", () => {
  it("resolves a known key to its LI.FI display identity", () => {
    expect(getBridgeToolDisplay("across").name).toBe("Across")
    expect(getBridgeToolDisplay("relaydepository").name).toBe("Relay")
  })

  it("keeps an unknown key readable instead of dropping the route", () => {
    expect(getBridgeToolDisplay("brandNewBridge")).toEqual({
      name: "brandNewBridge",
      logoUrl: "",
    })
  })

  it("does not resolve inherited Object properties as bridges", () => {
    expect(getBridgeToolDisplay("toString")).toEqual({ name: "toString", logoUrl: "" })
  })
})
