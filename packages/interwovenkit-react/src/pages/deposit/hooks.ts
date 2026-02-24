import type { BalancesResponseJson } from "@skip-go/client"
import { useMemo } from "react"
import { useFormContext } from "react-hook-form"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { NormalizedAsset } from "@/data/assets"
import { assetQueryKeys } from "@/data/assets"
import { STALE_TIMES } from "@/data/http"
import { useLocationState } from "@/lib/router"
import { useHexAddress, useInitiaAddress } from "@/public/data/hooks"
import type { AllAssetsResponse } from "../bridge/data/assets"
import { useAllSkipAssets } from "../bridge/data/assets"
import type { RouterChainJson } from "../bridge/data/chains"
import { useFindSkipChain } from "../bridge/data/chains"
import { skipQueryKeys, useSkip } from "../bridge/data/skip"
import type { BridgeTxResult } from "../bridge/data/tx"

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

export interface TransferModeConfig {
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

  const data = useMemo(() => {
    if (skipAssetsRaw) {
      const allAssets = Object.values(skipAssetsRaw.chain_to_assets_map).flatMap(
        (entry) => entry?.assets ?? [],
      )
      return localOptions.flatMap(({ denom, chainId }) => {
        const asset = allAssets.find((a) => a.denom === denom && a.chain_id === chainId)
        if (!asset) return []
        return [{ denom, chain_id: chainId, symbol: asset.symbol, logo_uri: asset.logo_uri ?? "" }]
      })
    }

    // Fallback: resolve from Initia registry cache, or use denom as symbol placeholder
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

export function useExternalAssetOptions(mode: TransferMode) {
  const skipAssets = useAllSkipAssets()
  const findChain = useFindSkipChain()
  const { data: balances, isLoading } = useAllBalancesQuery()
  const { remoteOptions = [] } = useLocationState<{ remoteOptions?: AssetOption[] }>()
  const localAsset = useLocalTransferAsset(mode)

  if (!localAsset) return { data: [], isLoading }

  const data = skipAssets
    .filter(({ symbol, denom, chain_id }) =>
      !remoteOptions.length
        ? symbol === localAsset.symbol
        : remoteOptions.some((opt) => opt.denom === denom && opt.chainId === chain_id),
    )
    .map((asset) => {
      if (asset.hidden) return null
      if (asset.chain_id === localAsset.chain_id) return null

      const chain = findChain(asset.chain_id)
      if (!chain) return null
      // filter out external cosmos chains (different wallet connection is required)
      if (chain.chain_type === "cosmos" && chain.bech32_prefix !== "init") return null

      const balance = balances?.[chain.chain_id]?.[asset.denom]

      // during deposit, show only assets with balance
      if (mode === "deposit" && (!balance || !Number(balance.amount))) return null

      return { asset, chain, balance }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)

  return { data, isLoading }
}

export function useTransferForm() {
  return useFormContext<TransferFormValues>()
}
