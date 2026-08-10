import BigNumber from "bignumber.js"
import { bcs, createMoveClient } from "@initia/utils"
import type { NormalizedChain, PriceItem } from "./chains"
import type { Config } from "./config"
import { IUSD_SYMBOL, STRAT_CHAIN_NAME, XSLP_SYMBOL } from "./constants"

function getScalarViewValue(result: unknown): unknown {
  if (Array.isArray(result)) return result[0]
  return result
}

function findBySymbol(prices: PriceItem[], symbol: string): PriceItem | undefined {
  return prices.find((price) => price.symbol?.toUpperCase() === symbol.toUpperCase())
}

/**
 * `get_xslp_price_in_collateral` returns a Move `BigDecimal`, serialized by the view-function REST
 * endpoint as a plain decimal string (e.g. "0.994..."), not a scaled base-unit integer.
 */
export function parseXslpPriceInCollateral(result: unknown): number | undefined {
  const value = getScalarViewValue(result)
  if (typeof value !== "string" && typeof value !== "number") return undefined

  const raw = String(value)
  if (!raw) return undefined

  const price = BigNumber(raw)
  if (!price.isFinite() || !price.gt(0)) return undefined
  return price.toNumber()
}

type StratConfig = Pick<Config, "stratLpModuleAddress" | "stratXslpCollateralMetadata">

/**
 * Supplements the indexer price list with xSLP's price via a Strat Move view call.
 *
 * The view function's argument is the vault's *collateral* metadata (e.g. iUSD), not xSLP's own —
 * so xSLP's `id` (denom) is looked up by symbol from the indexer response instead of derived from
 * an address. Result is converted to USD using the collateral's own indexer price, not assumed 1:1.
 */
export async function fetchStratSupplementalPrices(
  { chain_name, restUrl }: NormalizedChain,
  prices: PriceItem[],
  {
    stratLpModuleAddress: moduleAddress,
    stratXslpCollateralMetadata: collateralMetadata,
  }: StratConfig,
): Promise<PriceItem[]> {
  if (chain_name.toLowerCase() !== STRAT_CHAIN_NAME || !moduleAddress || !collateralMetadata)
    return []

  const xslp = findBySymbol(prices, XSLP_SYMBOL)
  if (!xslp || xslp.price > 0) return []

  try {
    const { viewFunction } = createMoveClient(restUrl)
    const result = await viewFunction<unknown>({
      moduleAddress,
      moduleName: "lp",
      functionName: "get_xslp_price_in_collateral",
      typeArgs: [],
      args: [bcs.object().serialize(collateralMetadata).toBase64()],
    })
    const priceInCollateral = parseXslpPriceInCollateral(result)
    if (!priceInCollateral) return []

    // `0` (present but unpriced, same pattern xSLP itself uses) must also fall back to 1, not `?? 1`.
    const collateralPrice = findBySymbol(prices, IUSD_SYMBOL)?.price
    const collateralUsdPrice = collateralPrice && collateralPrice > 0 ? collateralPrice : 1
    return [{ id: xslp.id, price: priceInCollateral * collateralUsdPrice }]
  } catch {
    return []
  }
}
