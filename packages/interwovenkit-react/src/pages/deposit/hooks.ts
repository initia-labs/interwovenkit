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

export function useLocalAssetDepositAsset() {
  const path = usePath()
  const isWithdraw = path === "/withdraw"
  const skipAssets = useAllSkipAssets()
  const { watch } = useTransferForm()

  const { dstChainId, dstDenom, srcChainId, srcDenom } = watch()

  // Local asset is destination during deposit, source during withdraw
  const chainId = isWithdraw ? srcChainId : dstChainId
  const denom = isWithdraw ? srcDenom : dstDenom

  return skipAssets.find(({ denom: d, chain_id }) => denom === d && chain_id === chainId) || null
}

export function useExternalDepositAsset() {
  const path = usePath()
  const isWithdraw = path === "/withdraw"
  const skipAssets = useAllSkipAssets()
  const { watch } = useTransferForm()

  const { srcChainId, srcDenom, dstChainId, dstDenom } = watch()

  // External asset is source during deposit, destination during withdraw
  const chainId = isWithdraw ? dstChainId : srcChainId
  const denom = isWithdraw ? dstDenom : srcDenom

  return skipAssets.find(({ denom: d, chain_id }) => denom === d && chain_id === chainId) || null
}

export function useExternalAssetOptions() {
  const path = usePath()
  const isWithdraw = path === "/withdraw"
  const skipAssets = useAllSkipAssets()
  const findChain = useFindSkipChain()
  const { data: balances, isLoading } = useAllBalancesQuery()
  const { remoteOptions = [] } = useLocationState<{ remoteOptions?: AssetOption[] }>()
  const localAsset = useLocalAssetDepositAsset()

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
      if (!isWithdraw && (!balance || !Number(balance.amount))) return null

      return { asset, chain, balance }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)

  return { data, isLoading }
}

export type TransferPage = "select-local" | "select-external" | "fields" | "completed"

interface TransferForm {
  page: TransferPage
  quantity: string
  srcDenom: string
  srcChainId: string
  dstDenom: string
  dstChainId: string
  // TX completion data
  result?: BridgeTxResult
}

export function useTransferForm() {
  return useFormContext<TransferForm>()
}
