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
import { useTransferFlow, useTransferForm, useTransferMode } from "./transferFlowConfig"

const ETHEREUM_CHAIN_ID = "1"
const ETHEREUM_USDC_DENOM = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
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
  const { watch } = useTransferForm()
  const values = watch()
  const chainId = values[external.chainIdKey]
  const denom = values[external.denomKey]

  return (
    skipAssets.find(
      ({ denom: d, chain_id }) =>
        normalizeDenom(denom) === normalizeDenom(d) && chain_id === chainId,
    ) || null
  )
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
  const balancesError = error ?? chainsError ?? null

  if (!localAsset) return { ...EMPTY_EXTERNAL_ASSET_OPTIONS_RESULT, isLoading, balancesError }

  const sourceOverride = getExternalSourceOverride(localAsset.symbol)
  const externalSourceSymbols = sourceOverride?.externalSourceSymbols ?? [localAsset.symbol]
  const hasRemoteOptions = remoteOptions.length > 0
  const extraExternalOptions = sourceOverride?.extraExternalOptions ?? []
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
    balancesError,
    supportedExternalChains,
    appchainSourceSymbols,
    externalSourceSymbols,
    localSymbol: localAsset.symbol,
  }
}
