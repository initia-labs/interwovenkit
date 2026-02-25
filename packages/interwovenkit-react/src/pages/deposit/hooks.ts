import type { BalancesResponseJson } from "@skip-go/client"
import { useMemo } from "react"
import { useFormContext } from "react-hook-form"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { NormalizedAsset } from "@/data/assets"
import { assetQueryKeys } from "@/data/assets"
import { STALE_TIMES } from "@/data/http"
import { useLocationState } from "@/lib/router"
import { useHexAddress, useInitiaAddress } from "@/public/data/hooks"
import { type AllAssetsResponse, type RouterAsset, useAllSkipAssets } from "../bridge/data/assets"
import {
  isInitiaAppchain,
  type RouterChainJson,
  useFindSkipChain,
  useGetIsInitiaChain,
  useSkipChains,
} from "../bridge/data/chains"
import { skipQueryKeys, useSkip } from "../bridge/data/skip"
import type { BridgeTxResult } from "../bridge/data/tx"

const IUSD_SYMBOL = "iUSD"

interface ExternalSourceOverride {
  sourceSymbol: string
  extraExternalOptions: AssetOption[]
  extraInitiaSourceSymbols: string[]
  externalChainListSource: "extra-options" | "supported-assets"
}

const EXTERNAL_SOURCE_OVERRIDES: Record<string, ExternalSourceOverride> = {
  [IUSD_SYMBOL]: {
    sourceSymbol: "USDC",
    extraExternalOptions: [{ chainId: "1", denom: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" }],
    extraInitiaSourceSymbols: ["USDC"],
    externalChainListSource: "extra-options",
  },
}

function matchesAssetOption(option: AssetOption, chainId: string, denom: string): boolean {
  if (option.chainId !== chainId) return false
  if (option.denom.startsWith("0x") && denom.startsWith("0x")) {
    return option.denom.toLowerCase() === denom.toLowerCase()
  }
  return option.denom === denom
}

function getExternalSourceOverride(localSymbol: string): ExternalSourceOverride | undefined {
  return EXTERNAL_SOURCE_OVERRIDES[localSymbol]
}

function getChainDisplayName(chain: RouterChainJson): string {
  return chain.pretty_name || chain.chain_name
}

function isSupportedExternalChain(chain: RouterChainJson): boolean {
  return chain.chain_type !== "cosmos" || chain.bech32_prefix === "init"
}

type ChainBalances = NonNullable<BalancesResponseJson["chains"]>
type DenomBalances = NonNullable<ChainBalances[string]["denoms"]>
type Balance = DenomBalances[string]

interface ExternalAssetOptionItem {
  asset: RouterAsset
  chain: RouterChainJson
  balance: Balance | undefined
}

interface ExternalAssetOptionsResult {
  data: ExternalAssetOptionItem[]
  isLoading: boolean
  supportedExternalChains: RouterChainJson[]
  appchainSourceSymbols: string[]
  externalSourceSymbol: string
  localSymbol: string
}

const EMPTY_EXTERNAL_ASSET_OPTIONS_RESULT: ExternalAssetOptionsResult = {
  data: [],
  isLoading: false,
  supportedExternalChains: [],
  appchainSourceSymbols: [],
  externalSourceSymbol: "",
  localSymbol: "",
}

export interface AssetOption {
  denom: string
  chainId: string
}

export type TransferPage = "select-local" | "select-external" | "fields" | "completed"

export interface TransferFormValues {
  page: TransferPage
  quantity: string
  srcDenom: string
  srcChainId: string
  dstDenom: string
  dstChainId: string
  // TX completion data
  result?: BridgeTxResult
}

export type TransferMode = "deposit" | "withdraw"

type TransferAssetDenomKey = "srcDenom" | "dstDenom"
type TransferAssetChainIdKey = "srcChainId" | "dstChainId"

interface TransferAssetKeys {
  denomKey: TransferAssetDenomKey
  chainIdKey: TransferAssetChainIdKey
}

interface TransferModeConfig {
  mode: TransferMode
  label: "Deposit" | "Withdraw"
  local: TransferAssetKeys
  external: TransferAssetKeys
}

const TRANSFER_MODE_CONFIG: Record<TransferMode, TransferModeConfig> = {
  deposit: {
    mode: "deposit",
    label: "Deposit",
    local: { denomKey: "dstDenom", chainIdKey: "dstChainId" },
    external: { denomKey: "srcDenom", chainIdKey: "srcChainId" },
  },
  withdraw: {
    mode: "withdraw",
    label: "Withdraw",
    local: { denomKey: "srcDenom", chainIdKey: "srcChainId" },
    external: { denomKey: "dstDenom", chainIdKey: "dstChainId" },
  },
}

export function useTransferMode(mode: TransferMode) {
  return TRANSFER_MODE_CONFIG[mode]
}

function useFilteredSkipChains() {
  const skip = useSkip()

  // Non-suspense: reads from prefetched cache if available, otherwise fetches
  const { data: chainsData, error } = useQuery({
    queryKey: skipQueryKeys.chains.queryKey,
    queryFn: () => skip.get("v2/info/chains").json<{ chains: RouterChainJson[] }>(),
    select: ({ chains }) =>
      chains.filter(
        ({ chain_type, bech32_prefix }) =>
          chain_type === "evm" || (chain_type === "cosmos" && bech32_prefix === "init"),
      ),
    staleTime: STALE_TIMES.MINUTE,
  })

  return { chains: chainsData ?? [], error }
}

export function useAllBalancesQuery() {
  const skip = useSkip()
  const hexAddress = useHexAddress()
  const initAddress = useInitiaAddress()
  const { chains: filteredChains, error: chainsError } = useFilteredSkipChains()

  const chainIds = useMemo(() => filteredChains.map(({ chain_id }) => chain_id), [filteredChains])

  const { data, error, isLoading } = useQuery({
    queryKey: skipQueryKeys.allBalances(chainIds, [hexAddress, initAddress]).queryKey,
    queryFn: () => {
      const chains = Object.fromEntries(
        filteredChains.map((chain) => [
          chain.chain_id,
          { address: chain.chain_type === "evm" ? hexAddress : initAddress, denoms: [] },
        ]),
      )
      return skip.post("v2/info/balances", { json: { chains } }).json<BalancesResponseJson>()
    },
    select: ({ chains }) => {
      if (!chains) return {}
      return Object.fromEntries(
        Object.entries(chains).map(([chainId, { denoms }]) => [chainId, denoms || {}]),
      )
    },
    enabled: !!initAddress && chainIds.length > 0,
    staleTime: STALE_TIMES.SECOND,
  })

  return { data, error, isLoading, chainsError }
}

/** Non-suspense: renders without suspending. Uses prefetched Skip data when available, falls back to Initia registry cache. */
export function useLocalAssetOptions() {
  const { localOptions = [] } = useLocationState<{ localOptions?: AssetOption[] }>()
  const queryClient = useQueryClient()
  const skip = useSkip()

  const { data: skipAssetsRaw, isLoading } = useQuery<AllAssetsResponse>({
    queryKey: skipQueryKeys.allAssets().queryKey,
    queryFn: () => skip.get("v2/fungible/assets").json<AllAssetsResponse>(),
    staleTime: STALE_TIMES.MINUTE,
  })

  // localOptions are denom/chainId pairs provided by the host dApp, so metadata
  // should always be available once Skip or registry data loads. Even if the
  // empty-string fallback is reached due to timing, raw denoms are machine
  // identifiers (often 60+ hex characters) unsuitable for display.
  const data = useMemo(() => {
    if (skipAssetsRaw) {
      const allAssets = Object.values(skipAssetsRaw.chain_to_assets_map).flatMap(
        (entry) => entry?.assets ?? [],
      )
      const assetMap = new Map(allAssets.map((a) => [`${a.chain_id}:${a.denom}`, a]))
      return localOptions.map(({ denom, chainId }) => {
        const asset = assetMap.get(`${chainId}:${denom}`)
        return {
          denom,
          chain_id: chainId,
          symbol: asset?.symbol ?? "",
          logo_uri: asset?.logo_uri ?? "",
        }
      })
    }

    // Fallback: resolve from Initia registry cache while Skip data loads
    return localOptions.map(({ denom, chainId }) => {
      const registryAsset = queryClient.getQueryData<NormalizedAsset>(
        assetQueryKeys.item(chainId, denom).queryKey,
      )
      return {
        denom,
        chain_id: chainId,
        symbol: registryAsset?.symbol ?? "",
        logo_uri: registryAsset?.logoUrl ?? "",
      }
    })
  }, [localOptions, skipAssetsRaw, queryClient])

  return { data, isLoading }
}

export function useLocalTransferAsset(mode: TransferMode) {
  const { local } = useTransferMode(mode)
  const skipAssets = useAllSkipAssets()
  const { watch } = useTransferForm()
  const values = watch()
  const chainId = values[local.chainIdKey]
  const denom = values[local.denomKey]

  return skipAssets.find(({ denom: d, chain_id }) => denom === d && chain_id === chainId) || null
}

export function useExternalTransferAsset(mode: TransferMode) {
  const { external } = useTransferMode(mode)
  const skipAssets = useAllSkipAssets()
  const { watch } = useTransferForm()
  const values = watch()
  const chainId = values[external.chainIdKey]
  const denom = values[external.denomKey]

  return skipAssets.find(({ denom: d, chain_id }) => denom === d && chain_id === chainId) || null
}

export function useExternalAssetOptions(mode: TransferMode): ExternalAssetOptionsResult {
  const skipAssets = useAllSkipAssets()
  const skipChains = useSkipChains()
  const findChain = useFindSkipChain()
  const getIsInitiaChain = useGetIsInitiaChain()
  const { data: balances, isLoading } = useAllBalancesQuery()
  const { remoteOptions = [] } = useLocationState<{ remoteOptions?: AssetOption[] }>()
  const localAsset = useLocalTransferAsset(mode)

  if (!localAsset) return { ...EMPTY_EXTERNAL_ASSET_OPTIONS_RESULT, isLoading }

  const sourceOverride = getExternalSourceOverride(localAsset.symbol)
  const externalSourceSymbol = sourceOverride?.sourceSymbol ?? localAsset.symbol
  const hasRemoteOptions = remoteOptions.length > 0
  const extraExternalOptions = sourceOverride?.extraExternalOptions ?? []
  const extraInitiaSourceSymbols = sourceOverride?.extraInitiaSourceSymbols ?? []
  const externalChainListSource = sourceOverride?.externalChainListSource ?? "supported-assets"
  const skipChainMap = new Map(skipChains.map((chain) => [chain.chain_id, chain]))

  const supportedAssets: ExternalAssetOptionItem[] = skipAssets
    .filter(({ symbol, denom, chain_id }) => {
      const isExtraExternalOption = extraExternalOptions.some((option) =>
        matchesAssetOption(option, chain_id, denom),
      )
      const chain = skipChainMap.get(chain_id)
      const isExtraInitiaSourceSymbol =
        !!chain && getIsInitiaChain(chain.chain_id) && extraInitiaSourceSymbols.includes(symbol)
      const hasOverrideSourceSymbol = isExtraExternalOption || isExtraInitiaSourceSymbol

      const isLocalSourceSymbol = symbol === localAsset.symbol

      if (!hasRemoteOptions) {
        return isLocalSourceSymbol || hasOverrideSourceSymbol
      }

      const isRemoteOption = remoteOptions.some((option) =>
        matchesAssetOption(option, chain_id, denom),
      )
      return isRemoteOption || hasOverrideSourceSymbol
    })
    .map((asset) => {
      if (asset.hidden) return null
      if (asset.chain_id === localAsset.chain_id) return null

      const chain = findChain(asset.chain_id)
      if (!chain) return null
      // filter out external cosmos chains (different wallet connection is required)
      if (!isSupportedExternalChain(chain)) return null

      const balance = balances?.[chain.chain_id]?.[asset.denom]

      return { asset, chain, balance }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)

  const data = supportedAssets.filter(
    ({ balance }) => mode !== "deposit" || (!!balance && Number(balance.amount) > 0),
  )

  const supportedExternalChainMap = new Map<string, RouterChainJson>()
  if (externalChainListSource === "extra-options") {
    for (const { chainId } of extraExternalOptions) {
      const chain = skipChainMap.get(chainId)
      if (!chain) continue
      if (!isSupportedExternalChain(chain)) continue
      if (getIsInitiaChain(chain.chain_id)) continue
      supportedExternalChainMap.set(chain.chain_id, chain)
    }
  } else {
    // Intentionally uses `data` (balance-filtered) instead of `supportedAssets`.
    // For non-override tokens, external chain names only appear when the user
    // actually holds a balance, so the empty-state description falls back to
    // appchain-only or generic copy by design.
    for (const { chain } of data) {
      if (getIsInitiaChain(chain.chain_id)) continue
      supportedExternalChainMap.set(chain.chain_id, chain)
    }
  }
  const supportedExternalChains = Array.from(supportedExternalChainMap.values()).sort((a, b) =>
    getChainDisplayName(a).localeCompare(getChainDisplayName(b)),
  )
  const appchainSourceSymbols = [
    ...new Set(
      supportedAssets
        .filter(({ chain }) => isInitiaAppchain(chain, getIsInitiaChain))
        .map(({ asset }) => asset.symbol),
    ),
  ]

  return {
    data,
    isLoading,
    supportedExternalChains,
    appchainSourceSymbols,
    externalSourceSymbol,
    localSymbol: localAsset.symbol,
  }
}

export function useTransferForm() {
  return useFormContext<TransferFormValues>()
}
