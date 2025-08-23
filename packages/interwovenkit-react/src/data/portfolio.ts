import BigNumber from "bignumber.js"
import { ascend, descend, head, pick, prop, sortWith, zipObj } from "ramda"
import type { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin"
import { fromBaseUnit } from "@initia/utils"
import placeholder from "./placeholder"
import { useConfig } from "./config"
import type { NormalizedChain, PriceItem } from "./chains"
import { useAllChainPriceQueries, useInitiaRegistry } from "./chains"
import { useAllChainAssetsQueries, type NormalizedAsset } from "./assets"
import { useAllChainBalancesQueries } from "./account"

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
  unsupported?: boolean
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
export function calcTotalValue(group: PortfolioAssetGroup): number {
  return group.assets.reduce((sum, { value }) => sum + (value ?? 0), 0)
}

/** Calculates total quantity for an asset group */
export function calcTotalQuantity(group: PortfolioAssetGroup): string {
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
    descend(({ symbol }) => symbol === "INIT"),
    descend(calcTotalValue),
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
 * Sorts unsupported assets with deterministic rules:
 * 1. Initia first
 * 2. Alphabetically by chain name
 * 3. Alphabetically by denom
 */
export function sortUnsupportedAssets(unsupportedAssets: PortfolioAssetItem[]) {
  return sortWith<PortfolioAssetItem>([
    descend(({ chain }) => chain.name === "Initia"),
    ascend(({ chain }) => chain.name),
    ascend(({ denom }) => denom),
  ])(unsupportedAssets)
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
        unsupported: !asset,
        chain: toChainInfo(chain),
      })
    }

    assetItemsByChain[chainId] = items
  }

  // chains by value
  const chainItemsMap = new Map<string, PortfolioChainItem>()

  for (const [chainId, items] of Object.entries(assetItemsByChain)) {
    const chain = chains.find((chain) => chain.chainId === chainId)
    if (!chain) continue

    const totalValue = items.reduce((sum, { value }) => sum + (value ?? 0), 0)
    chainItemsMap.set(chainId, { ...toChainInfo(chain), value: totalValue })
  }

  // asset groups
  const assetGroupsMap = new Map<string, PortfolioAssetItem[]>()

  for (const items of Object.values(assetItemsByChain)) {
    for (const item of items) {
      if (!item.unsupported) {
        const { symbol } = item
        const existing = assetGroupsMap.get(symbol) ?? []
        assetGroupsMap.set(symbol, [...existing, item])
      }
    }
  }

  const assetGroups: PortfolioAssetGroup[] = []
  for (const [symbol, assets] of assetGroupsMap) {
    const firstAsset = head(assets)
    if (!firstAsset) continue

    assetGroups.push({ ...firstAsset, symbol, assets: sortAssets(assets) })
  }

  // unsupported assets
  const unsupportedAssets: PortfolioAssetItem[] = []

  for (const items of Object.values(assetItemsByChain)) {
    for (const item of items) {
      if (item.unsupported) {
        unsupportedAssets.push(item)
      }
    }
  }

  return {
    chainsByValue: sortChainItems(Array.from(chainItemsMap.values()), defaultChainId),
    assetGroups: sortAssetGroups(assetGroups),
    unsupportedAssets: sortUnsupportedAssets(unsupportedAssets),
    totalValue: assetGroups.reduce((sum, group) => sum + calcTotalValue(group), 0),
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

  const isLoading = [balances, assets, prices].some((queries) =>
    queries.some(({ isLoading }) => isLoading),
  )

  const refetch = () => {
    balances.forEach(({ refetch }) => refetch())
    assets.forEach(({ refetch }) => refetch())
    prices.forEach(({ refetch }) => refetch())
  }

  return { ...portfolio, isLoading, refetch }
}
