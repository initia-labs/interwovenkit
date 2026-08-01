// Optional fake source network for GET /v1/config/assets. The deployed backend
// serves a single source chain (Ethereum), so the widget's "Supported network"
// selector only appears with 2+ options (SourceSelector). With
// `fakeSourceNetwork` on, each known asset is mirrored onto Arbitrum to make the
// multi-option selector testable without a backend change.

import type { Context } from "hono"
import type { Asset } from "../../../packages/interwovenkit-react/src/pages/deposit/data/types.ts"
import { fetchAssets } from "./proxy.ts"
import { getConfig } from "./state.ts"

/**
 * Arbitrum One. A chain the Router (Skip) actually serves, so the widget
 * resolves a real chain name/logo for the selector option.
 */
const FAKE_SRC_CHAIN_ID = "42161"

/**
 * Real Arbitrum denoms keyed by upstream (Ethereum) src_denom. The widget groups
 * source routes by the Router-resolved display symbol, so the mirror must resolve
 * to the same symbol ("USDC", "ETH"); a made-up denom would split into a separate
 * invisible asset option instead of a second network. Unmapped assets aren't
 * mirrored.
 */
const FAKE_SRC_DENOMS: Record<string, string> = {
  // USDC: native Arbitrum issuance
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  // native ETH
  "ethereum-native": "arbitrum-native",
}

function doubleAmount(amount: string): string {
  return /^\d+$/.test(amount) ? String(BigInt(amount) * 2n) : amount
}

/**
 * Appends a fake Arbitrum mirror of each mappable asset, with the minimum doubled
 * so the two networks visibly disagree (per-chain minimums keep the selector
 * interactive). Quotes and processing-time lookups for the fake route hit the
 * upstream and are rejected; the widget degrades gracefully.
 */
export function withFakeSourceNetwork(assets: Asset[]): Asset[] {
  const fakes = assets.flatMap((asset) => {
    const fakeDenom = FAKE_SRC_DENOMS[asset.src_denom]
    if (!fakeDenom || asset.src_chain_id === FAKE_SRC_CHAIN_ID) return []
    return [
      {
        ...asset,
        src_chain_id: FAKE_SRC_CHAIN_ID,
        src_denom: fakeDenom,
        min_deposit_amount: doubleAmount(asset.min_deposit_amount),
      },
    ]
  })
  return [...assets, ...fakes]
}

/** GET /v1/config/assets: upstream assets, plus the fake network when enabled. */
export async function handleAssets(c: Context): Promise<Response> {
  try {
    const assets = await fetchAssets()
    return c.json({
      assets: getConfig().fakeSourceNetwork ? withFakeSourceNetwork(assets) : assets,
    })
  } catch (error) {
    console.error("upstream request failed", "/v1/config/assets", error)
    return c.json({ error: "upstream request failed" }, 502)
  }
}
