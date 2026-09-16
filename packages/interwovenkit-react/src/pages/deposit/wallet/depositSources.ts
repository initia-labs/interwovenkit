import { toBaseUnit } from "@initia/utils"
import { parseQuantity } from "@/lib/amountValidation"
import type { AssetOption } from "../data/assetOptions"
import { normalizeDenom } from "../data/assetOptions"
import { routeFeedsDestination } from "../data/assets"
import { isIntegerString } from "../data/parse"
import { findDestinationNetwork } from "../data/source"
import type { Asset, DestinationNetwork } from "../data/types"

export const ETHEREUM_CHAIN_ID = "1"
/** Canonical Ethereum USDC contract; the only asset the Deposit API's Ethereum route accepts. */
export const ETHEREUM_USDC_DENOM = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
const BASE_CHAIN_ID = "8453"
const BASE_USDC_DENOM = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const ARBITRUM_CHAIN_ID = "42161"
const ARBITRUM_USDC_DENOM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"

// Hot-linked LI.FI artwork (never vendored), fallback only: a broken image must never
// change route eligibility, minimum gates or signing.
const LIFI_ICON_BASE = "https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons"

const lifiIcon = (path: string) => `${LIFI_ICON_BASE}/${path}.svg`

/** The token logo is deliberately absent: callers resolve USDC artwork from the registry they already load, so only the chain logo needs a built-in fallback. */
export interface DepositApiSource {
  chainId: "1" | "8453" | "42161"
  denom: string
  symbol: "USDC"
  decimals: 6
  chainName: "Ethereum" | "Base" | "Arbitrum"
  /** How the source reaches the issued Ethereum address: "direct" is one ERC-20 transfer, "lifi" goes through the bridge options/quote leg first. */
  transport: "direct" | "lifi"
  fallbackChainLogoUrl: string
  // Receipt-capable JSON-RPC for the pinned reads: the Router registry's publicnode `rpc`
  // for Base and Arbitrum refuses `eth_getTransactionReceipt` without a paid token.
  rpcUrl?: string
}

// The exact three pairs the backend allowlists: it rejects anything else (native ETH,
// legacy Arbitrum USDC.e), so an unlisted source must keep its existing Router behavior.
export const DEPOSIT_API_SOURCES: readonly DepositApiSource[] = [
  {
    chainId: ETHEREUM_CHAIN_ID,
    denom: ETHEREUM_USDC_DENOM,
    symbol: "USDC",
    decimals: 6,
    chainName: "Ethereum",
    transport: "direct",
    fallbackChainLogoUrl: lifiIcon("chains/ethereum"),
    // Pinned even though the Router entry serves receipts, so tracking a transfer in
    // flight never depends on the Router registry being reachable.
    rpcUrl: "https://ethereum-rpc.publicnode.com",
  },
  {
    chainId: BASE_CHAIN_ID,
    denom: BASE_USDC_DENOM,
    symbol: "USDC",
    decimals: 6,
    chainName: "Base",
    transport: "lifi",
    fallbackChainLogoUrl: lifiIcon("chains/base"),
    rpcUrl: "https://mainnet.base.org",
  },
  {
    chainId: ARBITRUM_CHAIN_ID,
    denom: ARBITRUM_USDC_DENOM,
    symbol: "USDC",
    decimals: 6,
    chainName: "Arbitrum",
    transport: "lifi",
    fallbackChainLogoUrl: lifiIcon("chains/arbitrum"),
    rpcUrl: "https://arb1.arbitrum.io/rpc",
  },
]

export function findDepositApiSource(chainId: string, denom: string): DepositApiSource | undefined {
  // host vs Skip vs Deposit API casing — see normalizeDenom
  return DEPOSIT_API_SOURCES.find(
    (source) =>
      source.chainId === chainId && normalizeDenom(source.denom) === normalizeDenom(denom),
  )
}

export function depositApiRpcUrl(chainId: string): string | undefined {
  return DEPOSIT_API_SOURCES.find((source) => source.chainId === chainId)?.rpcUrl
}

export type DepositTransport = "router" | "direct" | "lifi"

// `unavailable` is deliberately distinct from `router`: once the Deposit API owns a source
// pair, a catalog outage must not hand it to an executor with different fees and minimums.
export type DepositTransportResolution =
  | { transport: "router" }
  | {
      transport: "direct" | "lifi"
      source: DepositApiSource
      /** The Ethereum USDC catalog route; carries the live `min_deposit_amount`. */
      route: Asset
      destination: DestinationNetwork
    }
  | { transport: "unavailable"; source: DepositApiSource; reason: "loading" | "error" }

interface ResolveDepositTransportParams {
  mode: "deposit" | "withdraw"
  hasDepositApi: boolean
  srcChainId: string
  srcDenom: string
  dstChainId: string
  dstDenom: string
  /** `/v1/config/assets`; undefined while loading or after an error. */
  catalog: Asset[] | undefined
  catalogError: boolean
}

// Ordered so the safe answer wins early: Withdraw and an unconfigured Deposit API consult
// no catalog at all, and a source outside the allowlist stays Router's. A *successful*
// catalog with no Ethereum USDC route is a confirmed unsupported pair, not an outage.
export function resolveDepositTransport(
  params: ResolveDepositTransportParams,
): DepositTransportResolution {
  const { mode, hasDepositApi, srcChainId, srcDenom, dstChainId, dstDenom } = params
  const { catalog, catalogError } = params

  if (mode === "withdraw" || !hasDepositApi) return { transport: "router" }

  const source = findDepositApiSource(srcChainId, srcDenom)
  if (!source) return { transport: "router" }

  if (!catalog) {
    return { transport: "unavailable", source, reason: catalogError ? "error" : "loading" }
  }

  // Every transport delivers to the issued Ethereum address, so the Ethereum USDC route's
  // minimum and destination support govern — even for a Base or Arbitrum send.
  const route = catalog.find(
    (asset) =>
      asset.src_chain_id === ETHEREUM_CHAIN_ID &&
      normalizeDenom(asset.src_denom) === normalizeDenom(ETHEREUM_USDC_DENOM),
  )
  if (!route || !routeFeedsDestination(route, dstChainId, dstDenom)) return { transport: "router" }

  const destination = findDestinationNetwork(route, dstChainId, dstDenom)
  if (!destination) return { transport: "router" }

  return { transport: source.transport, source, route, destination }
}

/** An empty allowlist means the host set none (the public API's "no constraint"), not "permit nothing". */
export function intersectHostSources(
  sources: readonly DepositApiSource[],
  remoteOptions: AssetOption[],
): DepositApiSource[] {
  if (remoteOptions.length === 0) return [...sources]
  return sources.filter((source) =>
    remoteOptions.some(
      (option) =>
        option.chainId === source.chainId &&
        normalizeDenom(option.denom) === normalizeDenom(source.denom),
    ),
  )
}

export interface BridgeToolDisplay {
  name: string
  logoUrl: string
}

// LI.FI's own tools metadata, checked in because the Deposit API's options response carries
// a bridge key only. Generated from `https://li.quest/v1/tools` (bridges[], key → name/logoURI).
// Display only, never an execution allowlist — see getBridgeToolDisplay.
export const BRIDGE_TOOLS: Record<string, BridgeToolDisplay> = {
  arbitrum: { name: "Arbitrum Bridge", logoUrl: lifiIcon("bridges/arbitrum") },
  across: { name: "AcrossV4", logoUrl: lifiIcon("bridges/across") },
  gnosis: { name: "Gnosis Bridge", logoUrl: lifiIcon("bridges/gnosis") },
  omni: { name: "Omni Bridge", logoUrl: lifiIcon("bridges/omni") },
  celercircle: { name: "CCTP + Celer (Standard)", logoUrl: lifiIcon("bridges/circle") },
  celercirclefast: { name: "CCTP + Celer (Fast)", logoUrl: lifiIcon("bridges/circle") },
  allbridge: { name: "Allbridge", logoUrl: lifiIcon("bridges/allbridge") },
  squid: { name: "Squid", logoUrl: lifiIcon("bridges/squid") },
  mayan: { name: "Mayan (Swift)", logoUrl: lifiIcon("bridges/mayan") },
  mayanWH: { name: "Mayan (Wormhole)", logoUrl: lifiIcon("bridges/mayan") },
  mayanMCTP: { name: "CCTP + Mayan", logoUrl: lifiIcon("bridges/mayan") },
  stargateV2: { name: "StargateV2 (Fast mode)", logoUrl: lifiIcon("bridges/stargate") },
  stargateV2Bus: { name: "StargateV2 (Economy mode)", logoUrl: lifiIcon("bridges/stargate") },
  symbiosis: { name: "Symbiosis", logoUrl: lifiIcon("bridges/symbiosis") },
  polygon: { name: "Polygon Bridge (PoS)", logoUrl: lifiIcon("bridges/polygon") },
  glacis: { name: "Glacis", logoUrl: lifiIcon("bridges/glacis") },
  chainflip: { name: "Chainflip", logoUrl: lifiIcon("bridges/chainflip") },
  gasZipBridge: { name: "GasZip", logoUrl: lifiIcon("bridges/gaszip") },
  relaydepository: { name: "Relay", logoUrl: lifiIcon("bridges/relay") },
  mayanFastMCTP: { name: "CCTPv2 + Mayan", logoUrl: lifiIcon("bridges/mayan") },
  unit: { name: "Unit", logoUrl: lifiIcon("bridges/unit") },
  polymer: { name: "Polymer (Fast)", logoUrl: lifiIcon("bridges/polymer") },
  polymerStandard: { name: "Polymer (Standard)", logoUrl: lifiIcon("bridges/polymer") },
  cctp: { name: "Circle CCTP", logoUrl: lifiIcon("bridges/circle") },
  eco: { name: "Eco", logoUrl: lifiIcon("bridges/eco") },
  near: { name: "NearIntents", logoUrl: lifiIcon("bridges/near") },
  hyperliquidSA: { name: "Hyperliquid", logoUrl: lifiIcon("chains/hyperliquid") },
  lifiIntents: { name: "LI.FI Intents", logoUrl: lifiIcon("bridges/lifi") },
  garden: { name: "Garden", logoUrl: lifiIcon("bridges/garden") },
  megaeth: { name: "MegaETH Gateway", logoUrl: lifiIcon("bridges/megaeth") },
  hyperliquidNative: { name: "Hyperliquid Native", logoUrl: lifiIcon("chains/hyperliquid") },
  superset: { name: "Superset", logoUrl: lifiIcon("bridges/superset") },
  paxos: { name: "Paxos Labs Transit", logoUrl: lifiIcon("bridges/paxos") },
  smartDeposits: { name: "Smart Deposits", logoUrl: lifiIcon("bridges/lifi") },
  layerswap: { name: "Layerswap", logoUrl: lifiIcon("bridges/layerswap") },
  frax: { name: "Frax Bridge", logoUrl: lifiIcon("bridges/frax") },
}

// An unknown key keeps its raw readable name and an empty logo: refusing to render a route
// the backend called eligible would hide a working deposit path behind stale metadata.
export function getBridgeToolDisplay(key: string): BridgeToolDisplay {
  // Own-property check: a bridge key such as "constructor" would otherwise resolve to an
  // inherited Object member and render a function where a route name belongs.
  return Object.hasOwn(BRIDGE_TOOLS, key) ? BRIDGE_TOOLS[key] : { name: key, logoUrl: "" }
}

// "" when the input cannot be represented (empty, non-numeric, negative). No JavaScript
// `Number` touches the value: a USDC amount past 2^53 base units would lose precision.
export function toBaseUnitString(quantity: string, decimals: number): string {
  const parsed = parseQuantity(quantity)
  if (!parsed || parsed.lt(0)) return ""

  const base = toBaseUnit(parsed.toString(), { decimals })
  return isIntegerString(base) ? base : ""
}
