import { describe, expect, it } from "vitest"
import type { Asset, DestinationNetwork } from "../data/types"
import {
  BRIDGE_TOOLS,
  DEPOSIT_API_SOURCES,
  depositApiRpcUrl,
  ETHEREUM_CHAIN_ID,
  ETHEREUM_USDC_DENOM,
  findDepositApiSource,
  getBridgeToolDisplay,
  intersectHostSources,
  resolveDepositTransport,
  toBaseUnitString,
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

describe("DEPOSIT_API_SOURCES", () => {
  // Not a preference list: the backend rejects anything outside these pairs
  // (native ETH is out of scope and legacy Arbitrum USDC.e is refused outright).
  it("is exactly the three canonical USDC pairs", () => {
    expect(DEPOSIT_API_SOURCES.map(({ chainId, symbol }) => `${chainId}:${symbol}`)).toEqual([
      "1:USDC",
      "8453:USDC",
      "42161:USDC",
    ])
  })

  it("routes Ethereum directly and the L2s through LI.FI", () => {
    expect(DEPOSIT_API_SOURCES.map(({ transport }) => transport)).toEqual([
      "direct",
      "lifi",
      "lifi",
    ])
  })

  it("carries six decimals and a chain logo fallback for every source", () => {
    for (const source of DEPOSIT_API_SOURCES) {
      expect(source.decimals).toBe(6)
      expect(source.fallbackChainLogoUrl).toMatch(/^https:\/\//)
    }
  })
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

  // Explicitly out of scope; each must keep its existing Router behavior.
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
    // Every transport delivers to the issued Ethereum address, so the Ethereum
    // route's minimum is the one that governs — even for a Base send.
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

  // Withdraw and an unconfigured Deposit API keep today's behavior with no API
  // catalog consulted at all.
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

  // Once the Deposit API owns a source pair, an outage must not silently hand
  // the transfer to a different executor with different fees and minimums.
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

  // A successful catalog with no matching destination is a confirmed
  // unsupported pair, not an outage: Router keeps it, as today.
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
  // An empty allowlist is the public API's "no constraint", not "permit nothing".
  it("returns every source when the host set no allowlist", () => {
    expect(intersectHostSources(DEPOSIT_API_SOURCES, [])).toHaveLength(3)
  })

  // A host that permits only Base USDC must never reveal Ethereum or Arbitrum.
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

  it("does not alias the shared source table", () => {
    const result = intersectHostSources(DEPOSIT_API_SOURCES, [])
    expect(result).not.toBe(DEPOSIT_API_SOURCES)
  })
})

describe("BRIDGE_TOOLS", () => {
  it("covers every bridge key LI.FI published at generation time", () => {
    expect(Object.keys(BRIDGE_TOOLS)).toHaveLength(36)
  })

  it("carries a readable name and a hot-linked logo for each key", () => {
    for (const [key, { name, logoUrl }] of Object.entries(BRIDGE_TOOLS)) {
      expect(name, key).not.toBe("")
      expect(logoUrl, key).toMatch(/^https:\/\/.+\.svg$/)
    }
  })

  it("resolves a known key to its LI.FI display identity", () => {
    expect(getBridgeToolDisplay("across").name).toBe("AcrossV4")
    expect(getBridgeToolDisplay("relaydepository").name).toBe("Relay")
  })

  // Display only, never an execution allowlist: refusing to render a route the
  // backend called eligible would hide a working deposit path behind stale
  // client-side metadata.
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

describe("toBaseUnitString", () => {
  it("converts a typed token amount to integer base units", () => {
    expect(toBaseUnitString("1", 6)).toBe("1000000")
    expect(toBaseUnitString("0.5", 6)).toBe("500000")
    expect(toBaseUnitString("1.234567", 6)).toBe("1234567")
  })

  it("floors sub-base-unit dust rather than rounding up", () => {
    expect(toBaseUnitString("1.2345678", 6)).toBe("1234567")
  })

  // A USDC amount past 2^53 base units would silently lose precision through
  // JavaScript `Number`; the string path keeps it exact.
  it("keeps large amounts exact", () => {
    expect(toBaseUnitString("9007199254740993", 6)).toBe("9007199254740993000000")
  })

  it("answers empty for anything that is not a usable amount", () => {
    for (const value of ["", " ", "abc", "-1", "1e6x"]) {
      expect(toBaseUnitString(value, 6)).toBe("")
    }
  })

  it("allows an explicit zero", () => {
    expect(toBaseUnitString("0", 6)).toBe("0")
  })
})

describe("depositApiRpcUrl", () => {
  test("overrides the Router RPC only where the registry endpoint cannot serve receipts", () => {
    expect(depositApiRpcUrl("8453")).toBe("https://mainnet.base.org")
    expect(depositApiRpcUrl("42161")).toBe("https://arb1.arbitrum.io/rpc")
    expect(depositApiRpcUrl("1")).toBe("https://ethereum-rpc.publicnode.com")
    expect(depositApiRpcUrl("10")).toBeUndefined()
  })
})
