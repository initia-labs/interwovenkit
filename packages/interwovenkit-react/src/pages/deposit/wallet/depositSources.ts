import type { AssetOption } from "../data/assetOptions"
import { normalizeDenom } from "../data/assetOptions"
import { routeFeedsDestination } from "../data/assets"
import { ETHEREUM_CHAIN_ID, ETHEREUM_USDC_DENOM, findDestinationNetwork } from "../data/source"
import type { Asset, DestinationNetwork } from "../data/types"

const LIFI_ICON_BASE = "https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons"

const lifiIcon = (path: string) => `${LIFI_ICON_BASE}/${path}.svg`

export interface DepositApiSource {
  chainId: "1" | "8453" | "42161"
  denom: string
  symbol: "USDC"
  decimals: 6
  chainName: "Ethereum" | "Base" | "Arbitrum"
  transport: "direct" | "lifi"
  fallbackChainLogoUrl: string
  // The Router registry's Base and Arbitrum RPCs refuse eth_getTransactionReceipt.
  rpcUrl: string
}

// The exact pairs the backend allowlists; any other source keeps the Router path.
export const DEPOSIT_API_SOURCES: readonly DepositApiSource[] = [
  {
    chainId: ETHEREUM_CHAIN_ID,
    denom: ETHEREUM_USDC_DENOM,
    symbol: "USDC",
    decimals: 6,
    chainName: "Ethereum",
    transport: "direct",
    fallbackChainLogoUrl: lifiIcon("chains/ethereum"),
    rpcUrl: "https://ethereum-rpc.publicnode.com",
  },
  {
    chainId: "8453",
    denom: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    symbol: "USDC",
    decimals: 6,
    chainName: "Base",
    transport: "lifi",
    fallbackChainLogoUrl: lifiIcon("chains/base"),
    rpcUrl: "https://mainnet.base.org",
  },
  {
    chainId: "42161",
    denom: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    symbol: "USDC",
    decimals: 6,
    chainName: "Arbitrum",
    transport: "lifi",
    fallbackChainLogoUrl: lifiIcon("chains/arbitrum"),
    rpcUrl: "https://arb1.arbitrum.io/rpc",
  },
]

export function matchesAssetOption(option: AssetOption, chainId: string, denom: string): boolean {
  return option.chainId === chainId && normalizeDenom(option.denom) === normalizeDenom(denom)
}

export function findDepositApiSource(chainId: string, denom: string): DepositApiSource | undefined {
  return DEPOSIT_API_SOURCES.find((source) => matchesAssetOption(source, chainId, denom))
}

export function depositApiRpcUrl(chainId: string): string | undefined {
  return DEPOSIT_API_SOURCES.find((source) => source.chainId === chainId)?.rpcUrl
}

export function findEthereumUsdcRoute(catalog: Asset[] | undefined): Asset | undefined {
  return catalog?.find((asset) =>
    matchesAssetOption(
      { chainId: ETHEREUM_CHAIN_ID, denom: ETHEREUM_USDC_DENOM },
      asset.src_chain_id,
      asset.src_denom,
    ),
  )
}

export type DepositTransportResolution =
  | { transport: "router" }
  | {
      transport: "direct" | "lifi"
      source: DepositApiSource
      /** The Ethereum USDC catalog route, whose minimum applies to every transport. */
      route: Asset
      destination: DestinationNetwork
    }
  // A catalog outage must not hand a Deposit API pair to the Router.
  | { transport: "unavailable"; source: DepositApiSource; reason: "loading" | "error" }

interface ResolveDepositTransportParams {
  mode: "deposit" | "withdraw"
  hasDepositApi: boolean
  srcChainId: string
  srcDenom: string
  dstChainId: string
  dstDenom: string
  catalog: Asset[] | undefined
  catalogError: boolean
}

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

  const route = findEthereumUsdcRoute(catalog)
  if (!route || !routeFeedsDestination(route, dstChainId, dstDenom)) return { transport: "router" }

  const destination = findDestinationNetwork(route, dstChainId, dstDenom)
  if (!destination) return { transport: "router" }

  return { transport: source.transport, source, route, destination }
}

/** An empty allowlist means the host set none, not "permit nothing". */
export function intersectHostSources(
  sources: readonly DepositApiSource[],
  remoteOptions: AssetOption[],
): DepositApiSource[] {
  if (remoteOptions.length === 0) return [...sources]
  return sources.filter((source) =>
    remoteOptions.some((option) => matchesAssetOption(option, source.chainId, source.denom)),
  )
}

interface BridgeToolDisplay {
  name: string
  logoUrl: string
}

// Base/Arbitrum → Ethereum USDC tools from https://li.quest/v1/tools, names shortened to one line.
const BRIDGE_TOOLS: Record<string, BridgeToolDisplay> = {
  across: { name: "Across", logoUrl: lifiIcon("bridges/across") },
  arbitrum: { name: "Arbitrum Bridge", logoUrl: lifiIcon("bridges/arbitrum") },
  cctp: { name: "Circle CCTP", logoUrl: lifiIcon("bridges/circle") },
  celercircle: { name: "Celer CCTP", logoUrl: lifiIcon("bridges/circle") },
  celercirclefast: { name: "Celer CCTP Fast", logoUrl: lifiIcon("bridges/circle") },
  gasZipBridge: { name: "GasZip", logoUrl: lifiIcon("bridges/gaszip") },
  glacis: { name: "Glacis", logoUrl: lifiIcon("bridges/glacis") },
  layerswap: { name: "Layerswap", logoUrl: lifiIcon("bridges/layerswap") },
  lifiIntents: { name: "LI.FI Intents", logoUrl: lifiIcon("bridges/lifi") },
  mayan: { name: "Mayan Swift", logoUrl: lifiIcon("bridges/mayan") },
  mayanFastMCTP: { name: "Mayan CCTPv2", logoUrl: lifiIcon("bridges/mayan") },
  mayanMCTP: { name: "Mayan CCTP", logoUrl: lifiIcon("bridges/mayan") },
  mayanWH: { name: "Mayan Wormhole", logoUrl: lifiIcon("bridges/mayan") },
  polymer: { name: "Polymer Fast", logoUrl: lifiIcon("bridges/polymer") },
  polymerStandard: { name: "Polymer Standard", logoUrl: lifiIcon("bridges/polymer") },
  relaydepository: { name: "Relay", logoUrl: lifiIcon("bridges/relay") },
  squid: { name: "Squid", logoUrl: lifiIcon("bridges/squid") },
  stargateV2: { name: "Stargate Fast", logoUrl: lifiIcon("bridges/stargate") },
  stargateV2Bus: { name: "Stargate Economy", logoUrl: lifiIcon("bridges/stargate") },
  symbiosis: { name: "Symbiosis", logoUrl: lifiIcon("bridges/symbiosis") },
}

// An unknown key keeps its raw name: stale metadata must never hide an eligible route.
export function getBridgeToolDisplay(key: string): BridgeToolDisplay {
  return Object.hasOwn(BRIDGE_TOOLS, key) ? BRIDGE_TOOLS[key] : { name: key, logoUrl: "" }
}
