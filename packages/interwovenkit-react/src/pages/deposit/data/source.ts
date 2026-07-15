import BigNumber from "bignumber.js"
import { fromBaseUnit } from "@initia/utils"
import { normalizeDenom } from "./assetOptions"
import type { Asset, DestinationNetwork } from "./types"

// Pure helpers for the deposit QR screen's source Asset/Chain selectors.
//
// `config/assets` identifies a source route by `src_chain_id`/`src_denom`,
// which match the Router (Skip) identifiers exactly, so the selectors resolve
// display symbol/name/logo from the Router metadata (useSkipAssets /
// useSkipChains) rather than a local map. These helpers cover the derivation
// and the fallback labels used when the Router lacks an entry.

/** Fallback display symbol when the Router has no asset for a source denom. */
export function fallbackAssetSymbol(srcDenom: string): string {
  if (srcDenom.endsWith("-native")) return srcDenom.replace(/-native$/, "").toUpperCase()
  // Unknown ERC-20: show a shortened address rather than a misleading symbol.
  return srcDenom.startsWith("0x") ? `${srcDenom.slice(0, 6)}…${srcDenom.slice(-4)}` : srcDenom
}

/** Fallback display name when the Router has no chain entry for a source chain id. */
export function fallbackChainName(srcChainId: string): string {
  return srcChainId.charAt(0).toUpperCase() + srcChainId.slice(1)
}

/**
 * Formats a route's minimum deposit as "{amount} {symbol}" in token units (e.g.
 * "3 USDC"). The amount is in the source denom's base units, so pass the route's
 * `src_decimals`. Rounds up: understating a required minimum would let a user
 * send exactly the displayed amount and still end below_minimum (funds stranded,
 * no refund).
 */
export function formatSourceMin(minAmount: string, decimals: number, symbol: string): string {
  // fromBaseUnit caps at 6 decimals; ROUND_CEIL overrides its default
  // ROUND_DOWN at that cap.
  const converted = fromBaseUnit(minAmount, { decimals, roundingMode: BigNumber.ROUND_CEIL })
  return `${BigNumber(converted || 0).toFormat()} ${symbol}`
}

/**
 * Formats the backend route-policy slippage percent string for the read-only
 * "Max slippage" row: "0.5" -> "0.5%", "0.0" -> "0%".
 */
export function formatSlippagePercent(percent: string): string {
  return `${BigNumber(percent || 0).toFormat()}%`
}

/**
 * Formats a processing-time estimate in seconds for display, rounding up to
 * whole minutes ("~5 min"); sub-minute estimates read "< 1 min".
 */
export function formatProcessingTime(seconds: number): string {
  if (seconds < 60) return "< 1 min"
  return `~${Math.ceil(seconds / 60)} min`
}

/**
 * The destination-network entry of a route matching the receive selection,
 * e.g. to read its `processing_time_seconds`.
 */
export function findDestinationNetwork(
  route: Asset,
  chainId: string,
  denom: string,
): DestinationNetwork | undefined {
  // host vs Skip casing, see normalizeDenom
  return route.dst_networks.find(
    (network) =>
      network.chain_id === chainId && normalizeDenom(network.denom) === normalizeDenom(denom),
  )
}
