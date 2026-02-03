import type { BalancesResponseJson } from "@skip-go/client"
import { useFormContext } from "react-hook-form"
import { useQuery } from "@tanstack/react-query"
import { STALE_TIMES } from "@/data/http"
import { useLocationState, usePath } from "@/lib/router"
import { useHexAddress, useInitiaAddress } from "@/public/data/hooks"
import { useAllSkipAssets } from "../bridge/data/assets"
import { useFindSkipChain, useSkipChains } from "../bridge/data/chains"
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

export function getTransferModeFromPath(path: string): TransferMode {
  return path.startsWith("/withdraw") ? "withdraw" : "deposit"
}

export function useTransferMode(mode?: TransferMode) {
  const path = usePath()
  return TRANSFER_MODE_CONFIG[mode ?? getTransferModeFromPath(path)]
}

export function useAllBalancesQuery() {
  const skip = useSkip()
  const hexAddress = useHexAddress()
  const initAddress = useInitiaAddress()
  const allChains = useSkipChains()
  const chains = Object.fromEntries(
    allChains
      .filter(
        ({ chain_type, bech32_prefix }) =>
          chain_type === "evm" || (chain_type === "cosmos" && bech32_prefix === "init"),
      )
      .map((chain) => [
        chain.chain_id,
        { address: chain.chain_type === "evm" ? hexAddress : initAddress, denoms: [] },
      ]),
  )

  return useQuery({
    queryKey: skipQueryKeys.allBalances(Object.keys(chains), [hexAddress, initAddress]).queryKey,
    queryFn: () => skip.post("v2/info/balances", { json: { chains } }).json<BalancesResponseJson>(),
    select: ({ chains }) => {
      if (!chains) return {}
      return Object.fromEntries(
        Object.entries(chains).map(([chainId, { denoms }]) => [chainId, denoms || {}]),
      )
    },
    enabled: !!initAddress,
    staleTime: STALE_TIMES.SECOND,
  })
}

export function useLocalAssetOptions() {
  const { localOptions = [] } = useLocationState<{ localOptions?: AssetOption[] }>()
  const skipAssets = useAllSkipAssets()
  return skipAssets.filter(({ denom, chain_id }) =>
    localOptions.some((opt) => opt.denom === denom && opt.chainId === chain_id),
  )
}

export function useLocalAssetDepositAsset(mode?: TransferMode) {
  const { local } = useTransferMode(mode)
  const skipAssets = useAllSkipAssets()
  const { watch } = useTransferForm()
  const values = watch()
  const chainId = values[local.chainIdKey]
  const denom = values[local.denomKey]

  return skipAssets.find(({ denom: d, chain_id }) => denom === d && chain_id === chainId) || null
}

export function useExternalDepositAsset(mode?: TransferMode) {
  const { external } = useTransferMode(mode)
  const skipAssets = useAllSkipAssets()
  const { watch } = useTransferForm()
  const values = watch()
  const chainId = values[external.chainIdKey]
  const denom = values[external.denomKey]

  return skipAssets.find(({ denom: d, chain_id }) => denom === d && chain_id === chainId) || null
}

export function useExternalAssetOptions(mode?: TransferMode) {
  const { mode: currentMode } = useTransferMode(mode)
  const skipAssets = useAllSkipAssets()
  const findChain = useFindSkipChain()
  const { data: balances, isLoading } = useAllBalancesQuery()
  const { remoteOptions = [] } = useLocationState<{ remoteOptions?: AssetOption[] }>()
  const localAsset = useLocalAssetDepositAsset(currentMode)

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
      if (currentMode === "deposit" && (!balance || !Number(balance.amount))) return null

      return { asset, chain, balance }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)

  return { data, isLoading }
}

export function useTransferForm() {
  return useFormContext<TransferFormValues>()
}
