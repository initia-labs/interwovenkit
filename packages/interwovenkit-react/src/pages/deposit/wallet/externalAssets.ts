import { useConfig } from "@/data/config"
import { IUSD_SYMBOL } from "@/data/constants"
import { useLocationState } from "@/lib/router"
import { type RouterAsset, useAllSkipAssets } from "@/pages/bridge/data/assets"
import {
  isInitiaAppchain,
  type RouterChainJson,
  useFindSkipChain,
  useGetIsInitiaChain,
  useSkipChains,
} from "@/pages/bridge/data/chains"
import { type AssetOption, type DepositLocationState, normalizeDenom } from "../data/assetOptions"
import { type Balance, useAllBalancesQuery } from "./balances"
import type { DepositApiSource } from "./depositSources"
import {
  DEPOSIT_API_SOURCES,
  ETHEREUM_CHAIN_ID,
  ETHEREUM_USDC_DENOM,
  findDepositApiSource,
  intersectHostSources,
} from "./depositSources"
import type { TransferMode } from "./transferFlowConfig"
import { useTransferFlow, useTransferForm, useTransferMode } from "./transferFlowConfig"

const ETHEREUM_AUSD_DENOM = "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a"

interface ExternalSourceOverride {
  externalSourceSymbols: string[]
  extraExternalOptions: AssetOption[]
  extraInitiaSourceSymbols: string[]
  externalChainListSource: "extra-options" | "supported-assets"
}

const EXTERNAL_SOURCE_OVERRIDES: Record<string, ExternalSourceOverride> = {
  [IUSD_SYMBOL]: {
    externalSourceSymbols: ["USDC", "AUSD"],
    extraExternalOptions: [
      { chainId: ETHEREUM_CHAIN_ID, denom: ETHEREUM_USDC_DENOM },
      { chainId: ETHEREUM_CHAIN_ID, denom: ETHEREUM_AUSD_DENOM },
    ],
    extraInitiaSourceSymbols: ["USDC"],
    externalChainListSource: "extra-options",
  },
}

// A Deposit API source stays selectable on an unknown balance: its authoritative balance is a
// source-chain-pinned read (evmRpc), and Skip's aggregate snapshot may lag or omit the chain.
export function shouldShowTransferSource({
  mode,
  hasPositiveBalance,
  isDepositApiSource,
}: {
  mode: TransferMode
  hasPositiveBalance: boolean
  isDepositApiSource: boolean
}): boolean {
  if (mode !== "deposit") return true
  return isDepositApiSource || hasPositiveBalance
}

// Minimal Skip-shaped records for a backend-supported source Skip does not list: a missing
// record would break the asset row, the form's early return and the chain lookup all at once.
export function synthesizeDepositApiAsset(
  source: DepositApiSource,
  assetLogoUrl: string,
): RouterAsset {
  return {
    denom: source.denom,
    chain_id: source.chainId,
    symbol: source.symbol,
    name: source.symbol,
    decimals: source.decimals,
    logo_uri: assetLogoUrl,
  } as RouterAsset
}

export function synthesizeDepositApiChain(source: DepositApiSource): RouterChainJson {
  return {
    chain_id: source.chainId,
    chain_name: source.chainName,
    pretty_name: source.chainName,
    chain_type: "evm",
    logo_uri: source.fallbackChainLogoUrl,
    // Display-only stand-in for a chain Skip does not list. The pinned reads never come from
    // here; they use the source's own endpoint (DepositApiSource.rpcUrl).
    rpc: "",
    rest: "",
  } as RouterChainJson
}

function matchesAssetOption(option: AssetOption, chainId: string, denom: string): boolean {
  return option.chainId === chainId && normalizeDenom(option.denom) === normalizeDenom(denom)
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

interface ExternalAssetOptionItem {
  asset: RouterAsset
  chain: RouterChainJson
  balance: Balance | undefined
}

interface ExternalAssetOptionsResult {
  data: ExternalAssetOptionItem[]
  isLoading: boolean
  /**
   * Balance query failure (balances or the chain list behind them). Surfaced
   * so deposit-mode consumers can tell "the user holds nothing" apart from
   * "balances could not be loaded" — the deposit-mode filter drops every asset
   * without a balance snapshot, so a swallowed error would masquerade as an
   * empty portfolio.
   */
  balancesError: Error | null
  supportedExternalChains: RouterChainJson[]
  appchainSourceSymbols: string[]
  externalSourceSymbols: string[]
  localSymbol: string
}

const EMPTY_EXTERNAL_ASSET_OPTIONS_RESULT: ExternalAssetOptionsResult = {
  data: [],
  isLoading: false,
  balancesError: null,
  supportedExternalChains: [],
  appchainSourceSymbols: [],
  externalSourceSymbols: [],
  localSymbol: "",
}

// Empty when the Deposit API is not configured, so such a host sees exactly the Router-only source list.
function useDepositApiSourceOptions(): ExternalAssetOptionItem[] {
  const { depositApiUrl, registryUrl } = useConfig()
  const { remoteOptions = [] } = useLocationState<DepositLocationState>()
  const skipAssets = useAllSkipAssets()
  const skipChains = useSkipChains()

  if (!depositApiUrl) return []

  return intersectHostSources(DEPOSIT_API_SOURCES, remoteOptions).map((source) => {
    const asset =
      skipAssets.find(
        (candidate) =>
          candidate.chain_id === source.chainId &&
          normalizeDenom(candidate.denom) === normalizeDenom(source.denom),
      ) ?? synthesizeDepositApiAsset(source, `${registryUrl}/images/${source.symbol}.png`)
    const chain =
      skipChains.find((candidate) => candidate.chain_id === source.chainId) ??
      synthesizeDepositApiChain(source)
    return { asset, chain, balance: undefined }
  })
}

// host vs Skip casing — see normalizeDenom
export function useLocalTransferAsset() {
  const { local } = useTransferMode()
  const skipAssets = useAllSkipAssets()
  const { watch } = useTransferForm()
  const values = watch()
  const chainId = values[local.chainIdKey]
  const denom = values[local.denomKey]

  return (
    skipAssets.find(
      ({ denom: d, chain_id }) =>
        normalizeDenom(denom) === normalizeDenom(d) && chain_id === chainId,
    ) || null
  )
}

export function useExternalTransferAsset() {
  const { external } = useTransferMode()
  const skipAssets = useAllSkipAssets()
  const { depositApiUrl, registryUrl } = useConfig()
  const { watch } = useTransferForm()
  const values = watch()
  const chainId = values[external.chainIdKey]
  const denom = values[external.denomKey]

  const skipAsset = skipAssets.find(
    ({ denom: d, chain_id }) => normalizeDenom(denom) === normalizeDenom(d) && chain_id === chainId,
  )
  if (skipAsset) return skipAsset

  // The form's early return keys on this value: null would render nothing for a pair the backend supports.
  const source = depositApiUrl ? findDepositApiSource(chainId, denom) : undefined
  if (!source) return null
  return synthesizeDepositApiAsset(source, `${registryUrl}/images/${source.symbol}.png`)
}

/** Chain lookup that tolerates a source Skip has no entry for; `useFindSkipChain` would throw and take down the form. */
export function useFindTransferChain() {
  const skipChains = useSkipChains()
  const { depositApiUrl } = useConfig()
  return (chainId: string): RouterChainJson | null => {
    const chain = skipChains.find((candidate) => candidate.chain_id === chainId)
    if (chain) return chain
    const source = depositApiUrl
      ? DEPOSIT_API_SOURCES.find((candidate) => candidate.chainId === chainId)
      : undefined
    return source ? synthesizeDepositApiChain(source) : null
  }
}

export function useExternalAssetOptions(): ExternalAssetOptionsResult {
  const { mode } = useTransferFlow()
  const skipAssets = useAllSkipAssets()
  const skipChains = useSkipChains()
  const findChain = useFindSkipChain()
  const getIsInitiaChain = useGetIsInitiaChain()
  const { data: balances, error, chainsError, isLoading } = useAllBalancesQuery()
  const { remoteOptions = [] } = useLocationState<DepositLocationState>()
  const localAsset = useLocalTransferAsset()
  const depositApiSourceOptions = useDepositApiSourceOptions()
  const balancesError = error ?? chainsError ?? null

  if (!localAsset) return { ...EMPTY_EXTERNAL_ASSET_OPTIONS_RESULT, isLoading, balancesError }

  const sourceOverride = getExternalSourceOverride(localAsset.symbol)
  // Only the override that already offers USDC as a source (iUSD) is extended, never an unrelated asset's list.
  const depositApiSources = sourceOverride ? depositApiSourceOptions : []
  const externalSourceSymbols = sourceOverride?.externalSourceSymbols ?? [localAsset.symbol]
  const hasRemoteOptions = remoteOptions.length > 0
  const extraExternalOptions: AssetOption[] = [
    ...(sourceOverride?.extraExternalOptions ?? []),
    ...depositApiSources
      .map(({ asset }) => ({ chainId: asset.chain_id, denom: asset.denom }))
      .filter(
        (option) =>
          !(sourceOverride?.extraExternalOptions ?? []).some((existing) =>
            matchesAssetOption(existing, option.chainId, option.denom),
          ),
      ),
  ]
  const extraInitiaSourceSymbols = sourceOverride?.extraInitiaSourceSymbols ?? []
  const externalChainListSource = sourceOverride?.externalChainListSource ?? "supported-assets"
  const skipChainMap = new Map(skipChains.map((chain) => [chain.chain_id, chain]))

  const supportedAssets: ExternalAssetOptionItem[] = skipAssets
    .filter(({ symbol, denom, chain_id }) => {
      if (hasRemoteOptions) {
        return remoteOptions.some((option) => matchesAssetOption(option, chain_id, denom))
      }

      const isExtraExternalOption = extraExternalOptions.some((option) =>
        matchesAssetOption(option, chain_id, denom),
      )
      const chain = skipChainMap.get(chain_id)
      const isExtraInitiaSourceSymbol =
        !!chain && getIsInitiaChain(chain.chain_id) && extraInitiaSourceSymbols.includes(symbol)
      const hasOverrideSourceSymbol = isExtraExternalOption || isExtraInitiaSourceSymbol
      const isLocalSourceSymbol = symbol === localAsset.symbol

      return isLocalSourceSymbol || hasOverrideSourceSymbol
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

  // A backend-supported source Skip omits entirely still belongs in the list.
  const listedAssets = [
    ...supportedAssets,
    ...depositApiSources.filter(
      ({ asset }) =>
        !supportedAssets.some(
          (item) =>
            item.chain.chain_id === asset.chain_id &&
            normalizeDenom(item.asset.denom) === normalizeDenom(asset.denom),
        ),
    ),
  ]

  const isDepositApiOption = (chainId: string, denom: string) =>
    depositApiSources.some(
      ({ asset }) =>
        asset.chain_id === chainId && normalizeDenom(asset.denom) === normalizeDenom(denom),
    )

  const data = listedAssets.filter(({ asset, chain, balance }) =>
    shouldShowTransferSource({
      mode,
      hasPositiveBalance: !!balance && Number(balance.amount) > 0,
      isDepositApiSource: isDepositApiOption(chain.chain_id, asset.denom),
    }),
  )

  const supportedExternalChainMap = new Map<string, RouterChainJson>()
  if (externalChainListSource === "extra-options") {
    for (const { chainId } of extraExternalOptions) {
      const chain =
        skipChainMap.get(chainId) ??
        depositApiSources.find(({ chain }) => chain.chain_id === chainId)?.chain
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
      listedAssets
        .filter(({ chain }) => isInitiaAppchain(chain, getIsInitiaChain))
        .map(({ asset }) => asset.symbol),
    ),
  ]

  return {
    data,
    isLoading,
    balancesError,
    supportedExternalChains,
    appchainSourceSymbols,
    externalSourceSymbols,
    localSymbol: localAsset.symbol,
  }
}
