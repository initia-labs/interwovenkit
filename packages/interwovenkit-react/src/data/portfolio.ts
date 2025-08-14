import BigNumber from "bignumber.js"
import { prop, sortWith, descend, ascend } from "ramda"
import type { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin"
import { fromBaseUnit } from "@initia/utils"
import placeholder from "./placeholder"
import { useConfig } from "./config"
import type { NormalizedChain, PriceItem } from "./chains"
import { useAllChainPriceQueries, useInitiaRegistry } from "./chains"
import { useAllChainAssetsQueries, type NormalizedAsset } from "./assets"
import { useAllChainBalancesQueries } from "./account"

export interface AssetBalance {
  chain: NormalizedChain
  asset: NormalizedAsset
  denom: string
  amount: string
  quantity: string
  price: number
  value: number
}

export interface AssetGroup {
  asset: NormalizedAsset
  chains: AssetBalance[]
}

export interface ChainPortfolio {
  chain: NormalizedChain
  totalValue: number
}

export interface PortfolioData {
  assetGroups: AssetGroup[]
  unsupportedAssetGroups: AssetGroup[]
  chainPortfolios: ChainPortfolio[]
  totalValue: number
}

/**
 * Calculates total quantity for an asset group
 */
export function calculateAssetGroupTotalQuantity(group: AssetGroup): string {
  return group.chains.reduce((sum, { quantity }) => sum.plus(quantity), BigNumber(0)).toString()
}

/**
 * Calculates total value for an asset group
 */
export function calculateAssetGroupTotalValue(group: AssetGroup): number {
  return group.chains.reduce((sum, { value }) => sum + value, 0)
}

/**
 * Sorts asset groups with deterministic rules:
 * 1. INIT symbol always
 * 2. Higher total value
 * 3. Group with more chains
 * 4. Alphabetically by symbol
 */
export function sortAssetGroups(groups: AssetGroup[]): AssetGroup[] {
  return sortWith<AssetGroup>([
    descend(({ asset }) => asset.symbol === "INIT"),
    descend(calculateAssetGroupTotalValue),
    descend(({ chains }) => chains.length),
    ascend(({ asset }) => asset.symbol),
  ])(groups)
}

/**
 * Sorts chains within an asset group with deterministic rules:
 * 1. Higher value
 * 2. Alphabetically by chain name
 */
export function sortChainsWithinGroup(chains: AssetBalance[]): AssetBalance[] {
  return sortWith<AssetBalance>([
    descend(prop("value")),
    descend(prop("quantity")),
    ascend(({ chain }) => chain.name),
  ])(chains)
}

// Helper function to create asset group from first balance
function createAssetGroup(assetBalance: AssetBalance): AssetGroup {
  return {
    asset: assetBalance.asset,
    chains: [assetBalance],
  }
}

// Helper function to add balance to existing group
function addToAssetGroup(group: AssetGroup, assetBalance: AssetBalance): AssetGroup {
  return {
    ...group,
    chains: [...group.chains, assetBalance],
  }
}

// Helper function to group asset balances by symbol
function groupAssetBalances(assetBalances: AssetBalance[]): AssetGroup[] {
  const grouped = Object.values(
    assetBalances.reduce<Record<string, AssetGroup>>((acc, assetBalance) => {
      const symbol = assetBalance.asset.symbol
      const existing = acc[symbol]

      return {
        ...acc,
        [symbol]: existing
          ? addToAssetGroup(existing, assetBalance)
          : createAssetGroup(assetBalance),
      }
    }, {}),
  )

  return sortAssetGroups(grouped).map((group) => ({
    ...group,
    chains: sortChainsWithinGroup(group.chains),
  }))
}

// Helper to create asset balance from coin data
function createAssetBalance(
  chain: NormalizedChain,
  balance: Coin,
  asset: NormalizedAsset,
  price: number,
): AssetBalance {
  const { denom, amount } = balance
  const quantity = fromBaseUnit(amount, { decimals: asset.decimals })
  const value = Number(quantity) * price
  return { denom, amount, quantity, price, value, chain, asset }
}

// Helper to create unsupported asset balance
function createUnsupportedAssetBalance(chain: NormalizedChain, balance: Coin): AssetBalance {
  const { denom, amount } = balance
  const quantity = fromBaseUnit(amount, { decimals: 0 })
  const asset = { denom, symbol: denom, decimals: 0, logoUrl: placeholder }
  return { denom, amount, quantity, price: 0, value: 0, chain, asset }
}

// Process balances for a single chain
function processChainBalances(
  chain: NormalizedChain,
  balances: Coin[],
  assets: NormalizedAsset[],
  priceMap: Record<string, number>,
) {
  return balances
    .filter(({ amount }) => BigNumber(amount).gt(0))
    .reduce<{ supported: AssetBalance[]; unsupported: AssetBalance[] }>(
      (acc, balance) => {
        const asset = assets.find(({ denom }) => denom === balance.denom)
        const assetBalance = asset
          ? createAssetBalance(chain, balance, asset, priceMap[balance.denom] ?? 0)
          : createUnsupportedAssetBalance(chain, balance)

        return asset
          ? { ...acc, supported: [...acc.supported, assetBalance] }
          : { ...acc, unsupported: [...acc.unsupported, assetBalance] }
      },
      { supported: [], unsupported: [] },
    )
}

// Calculate chain portfolios from supported asset balances
function calculateChainPortfolios(
  supported: AssetBalance[],
  currentChainId?: string,
): ChainPortfolio[] {
  const portfolioMap = supported.reduce<Record<string, ChainPortfolio>>((acc, { chain, value }) => {
    const existing = acc[chain.chainId]
    return {
      ...acc,
      [chain.chainId]: {
        chain,
        totalValue: (existing?.totalValue ?? 0) + value,
      },
    }
  }, {})

  return sortWith<ChainPortfolio>([
    descend(({ chain }) => chain.chainId === currentChainId),
    descend(({ totalValue }) => totalValue),
  ])(Object.values(portfolioMap))
}

export function aggregatePortfolio(
  balanceResults: (Coin[] | undefined)[],
  assetsResults: (NormalizedAsset[] | undefined)[],
  pricesResults: (PriceItem[] | undefined)[],
  chains: NormalizedChain[],
  currentChainId?: string,
): PortfolioData {
  // Process all chains and collect asset balances
  const { supported, unsupported } = chains.reduce<{
    supported: AssetBalance[]
    unsupported: AssetBalance[]
  }>(
    (acc, chain, chainIndex) => {
      const balances = balanceResults[chainIndex] ?? []
      const assets = assetsResults[chainIndex] ?? []
      const prices = pricesResults[chainIndex] ?? []

      const priceMap = Object.fromEntries(prices.map(({ id, price }) => [id, price]))
      const { supported, unsupported } = processChainBalances(chain, balances, assets, priceMap)

      return {
        supported: [...acc.supported, ...supported],
        unsupported: [...acc.unsupported, ...unsupported],
      }
    },
    { supported: [], unsupported: [] },
  )

  return {
    assetGroups: groupAssetBalances(supported),
    unsupportedAssetGroups: groupAssetBalances(unsupported),
    chainPortfolios: calculateChainPortfolios(supported, currentChainId),
    totalValue: supported.reduce((sum, { value }) => sum + value, 0),
  }
}

export const usePortfolio = () => {
  const { defaultChainId } = useConfig()
  const chains = useInitiaRegistry()
  const queries = {
    balances: useAllChainBalancesQueries(),
    assets: useAllChainAssetsQueries(),
    prices: useAllChainPriceQueries(),
  }

  const results = {
    balances: queries.balances.map(prop("data")),
    assets: queries.assets.map(prop("data")),
    prices: queries.prices.map(prop("data")),
  }

  const isLoading = Object.values(queries).some((queryList) =>
    queryList.some(({ isLoading }) => isLoading),
  )

  const portfolio = aggregatePortfolio(
    results.balances,
    results.assets,
    results.prices,
    chains,
    defaultChainId,
  )

  return { ...portfolio, isLoading }
}
