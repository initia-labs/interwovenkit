import { INIT_SYMBOL, IUSD_SYMBOL } from "./constants"

const PINNED_ASSET_SYMBOLS: readonly string[] = [INIT_SYMBOL, IUSD_SYMBOL]

export function getPinnedAssetSymbolRank(symbol: string): number {
  const index = PINNED_ASSET_SYMBOLS.indexOf(symbol)
  return index === -1 ? Infinity : index
}
