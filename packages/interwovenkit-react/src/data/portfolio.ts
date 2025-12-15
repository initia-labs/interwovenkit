import BigNumber from "bignumber.js"
import type { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin"
import { ascend, descend, head, pick, prop, sortWith, zipObj } from "ramda"
import { fromBaseUnit } from "@initia/utils"
import { useAllChainBalancesQueries } from "./account"
import { type NormalizedAsset, useAllChainAssetsQueries } from "./assets"
import type { NormalizedChain, PriceItem } from "./chains"
import { useAllChainPriceQueries, useInitiaRegistry } from "./chains"
import { useConfig } from "./config"
import { INIT_SYMBOL } from "./constants"
import placeholder from "./placeholder"

export interface PortfolioAssetGroupInfo {
  symbol: string
  logoUrl: string
}

export interface PortfolioAssetGroup extends PortfolioAssetGroupInfo {
  assets: Array<PortfolioAssetItem>
}

export interface PortfolioAssetItem extends PortfolioAssetGroupInfo {
  amount: string
  denom: string
  decimals: number
  quantity: string
  price?: number
  value?: number
  address?: string
  unlisted?: boolean
  chain: PortfolioChainInfo
}

export interface PortfolioChainItem extends PortfolioChainInfo {
  value: number
}

export interface PortfolioChainInfo {
  chainId: string
  name: string
  logoUrl: string
}

/** Calculates total value for an asset group */
export function calculateTotalValue(group: PortfolioAssetGroup): number {
  return group.assets.reduce((sum, { value }) => sum + (value ?? 0), 0)
}

/** Calculates total quantity for an asset group */
export function calculateTotalQuantity(group: PortfolioAssetGroup): string {
  return group.assets.reduce((sum, { quantity }) => sum.plus(quantity), BigNumber(0)).toString()
}

function toAssetInfo(denom: string, asset?: NormalizedAsset): PortfolioAssetGroupInfo {
  return { symbol: asset?.symbol ?? denom, logoUrl: asset?.logoUrl ?? placeholder }
}

function toChainInfo(chain: NormalizedChain): PortfolioChainInfo {
  return pick(["chainId", "name", "logoUrl"], chain)
}

/**
 * Sorts asset groups with deterministic rules:
 * 1. INIT symbol always
 * 2. Higher total value
 * 3. Group with more chains
 * 4. Alphabetically by symbol
 */
export function sortAssetGroups(assetGroups: PortfolioAssetGroup[]) {
  return sortWith<PortfolioAssetGroup>([
    descend(({ symbol }) => symbol === INIT_SYMBOL),
    descend(calculateTotalValue),
    descend(({ assets }) => assets.length),
    ascend(({ symbol }) => symbol),
  ])(assetGroups)
}

/**
 * Sorts chains within an asset group with deterministic rules:
 * 1. Higher value
 * 2. Higher quantity
 * 3. Alphabetically by chain name
 */
export function sortAssets(assetItems: PortfolioAssetItem[]) {
  return sortWith<PortfolioAssetItem>([
    descend(({ value }) => value ?? 0),
    descend(({ quantity }) => Number(quantity)), // Supported assets only
    ascend(({ chain }) => chain.name),
  ])(assetItems)
}

/**
 * Sorts unlisted assets with deterministic rules:
 * 1. Initia (L1) first
 * 2. Alphabetically by chain name
 * 3. Alphabetically by denom
 */
export function sortUnlistedAssets(unlistedAssets: PortfolioAssetItem[], l1ChainId?: string) {
  return sortWith<PortfolioAssetItem>([
    descend(({ chain }) => chain.chainId === l1ChainId),
    ascend(({ chain }) => chain.name),
    ascend(({ denom }) => denom),
  ])(unlistedAssets)
}

/**
 * Sorts chains with deterministic rules:
 * 1. Default chain first
 * 2. Higher value
 */
export function sortChainItems(chainItems: PortfolioChainItem[], defaultChainId?: string) {
  return sortWith<PortfolioChainItem>([
    descend(({ chainId }) => chainId === defaultChainId),
    descend(prop("value")),
  ])(chainItems)
}

export function createPortfolio(
  chains: Array<NormalizedChain>,
  balancesByChain: Record<string, Coin[] | undefined>,
  assetsByChain: Record<string, NormalizedAsset[] | undefined>,
  pricesByChain: Record<string, PriceItem[] | undefined>,
  defaultChainId?: string,
) {
  // Find L1 chain for sorting
  const l1ChainId = chains.find((chain) => chain.metadata?.is_l1)?.chainId

  // asset items by chain
  const assetItemsByChain: Record<string, PortfolioAssetItem[]> = {}

  for (const chain of chains) {
    const chainId = chain.chainId
    const balances = balancesByChain[chainId] ?? []
    const assets = assetsByChain[chainId]
    const prices = pricesByChain[chainId]

    const items: PortfolioAssetItem[] = []

    for (const { amount, denom } of balances) {
      if (!BigNumber(amount).gt(0)) continue

      const asset = assets?.find((a) => a.denom === denom)
      const price = prices?.find((p) => p.id === denom)?.price
      const decimals = asset?.decimals ?? 0
      const quantity = fromBaseUnit(amount, { decimals })
      const value = price ? BigNumber(quantity).times(price).toNumber() : undefined

      items.push({
        ...toAssetInfo(denom, asset),
        amount,
        denom,
        decimals,
        quantity,
        price,
        value,
        address: asset?.address,
        unlisted: !asset,
        chain: toChainInfo(chain),
      })
    }

    assetItemsByChain[chainId] = items
  }

  // chains by value
  const chainItemsMap = new Map<string, PortfolioChainItem>()

  for (const [currentChainId, assetItems] of Object.entries(assetItemsByChain)) {
    // Only include chains with actual balances
    if (assetItems.length === 0) continue

    const chain = chains.find((chain) => chain.chainId === currentChainId)
    if (!chain) continue

    const totalValue = assetItems.reduce((sum, { value }) => sum + (value ?? 0), 0)
    chainItemsMap.set(currentChainId, { ...toChainInfo(chain), value: totalValue })
  }

  // asset groups
  const assetGroupsMap = new Map<string, PortfolioAssetItem[]>()

  for (const items of Object.values(assetItemsByChain)) {
    for (const item of items) {
      if (!item.unlisted) {
        const { symbol } = item
        const existing = assetGroupsMap.get(symbol) ?? []
        assetGroupsMap.set(symbol, [...existing, item])
      }
    }
  }

  const assetGroups: PortfolioAssetGroup[] = []
  for (const [symbol, assets] of assetGroupsMap) {
    const representativeAsset = head(assets)
    if (!representativeAsset) continue

    const sortedAssets = sortAssets(assets)
    assetGroups.push({ symbol, logoUrl: representativeAsset.logoUrl, assets: sortedAssets })
  }

  // unlisted assets
  const unlistedAssets: PortfolioAssetItem[] = []

  for (const items of Object.values(assetItemsByChain)) {
    for (const item of items) {
      if (item.unlisted) {
        unlistedAssets.push(item)
      }
    }
  }

  return {
    chainsByValue: sortChainItems(Array.from(chainItemsMap.values()), defaultChainId),
    assetGroups: sortAssetGroups(assetGroups),
    unlistedAssets: sortUnlistedAssets(unlistedAssets, l1ChainId),
    totalValue: assetGroups.reduce((sum, group) => sum + calculateTotalValue(group), 0),
  }
}

export function usePortfolio() {
  const { defaultChainId } = useConfig()
  const chains = useInitiaRegistry()
  const balances = useAllChainBalancesQueries()
  const assets = useAllChainAssetsQueries()
  const prices = useAllChainPriceQueries()

  const chainIds = chains.map((chain) => chain.chainId)
  const balancesByChain = zipObj(chainIds, balances.map(prop("data")))
  const assetsByChain = zipObj(chainIds, assets.map(prop("data")))
  const pricesByChain = zipObj(chainIds, prices.map(prop("data")))

  const portfolio = createPortfolio(
    chains,
    balancesByChain,
    assetsByChain,
    pricesByChain,
    defaultChainId,
  )

  const isLoading = [balances, assets, prices].flat().some(({ isLoading }) => isLoading)

  const refetch = () => {
    balances.forEach(({ refetch }) => refetch())
    assets.forEach(({ refetch }) => refetch())
    prices.forEach(({ refetch }) => refetch())
  }

  return { ...portfolio, isLoading, refetch }
}
