import type { BalancesResponseJson } from "@skip-go/client"
import { useFormContext } from "react-hook-form"
import { useQuery } from "@tanstack/react-query"
import { useConfig } from "@/data/config"
import { STALE_TIMES } from "@/data/http"
import { useHexAddress, useInitiaAddress } from "@/public/data/hooks"
import { useAllSkipAssets } from "../bridge/data/assets"
import { useFindSkipChain, useSkipChains } from "../bridge/data/chains"
import { skipQueryKeys, useSkip } from "../bridge/data/skip"

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

export function useDepositOptions() {
  const { depositOptions = [] } = useConfig()
  const skipAssets = useAllSkipAssets()
  return skipAssets.filter(({ denom, chain_id }) =>
    depositOptions.some((opt) => opt.denom === denom && opt.chainId === chain_id),
  )
}

export function useDstDepositAsset() {
  const skipAssets = useAllSkipAssets()
  const { watch } = useDepositForm()

  const { dstChainId, dstDenom } = watch()

  return (
    skipAssets.find(({ denom, chain_id }) => denom === dstDenom && chain_id === dstChainId) || null
  )
}

export function useSrcDepositAsset() {
  const skipAssets = useAllSkipAssets()
  const { watch } = useDepositForm()

  const { srcChainId, srcDenom } = watch()

  return (
    skipAssets.find(({ denom, chain_id }) => denom === srcDenom && chain_id === srcChainId) || null
  )
}

export function useDepositAssets() {
  const skipAssets = useAllSkipAssets()
  const findChain = useFindSkipChain()
  const { data: balances } = useAllBalancesQuery()

  const dstAsset = useDstDepositAsset()

  if (!dstAsset) return []

  return skipAssets
    .filter(({ symbol, chain_id }) => symbol === dstAsset.symbol && chain_id !== dstAsset.chain_id)
    .filter((asset) => {
      const chain = findChain(asset.chain_id)
      if (!chain) return false
      // filter out external cosmos chains (different wallet connection is required)
      if (chain.chain_type === "cosmos" && chain.bech32_prefix !== "init") return false

      const amount = balances?.[chain.chain_id][asset.denom]?.amount
      if (!amount || !Number(amount)) return false

      return true
    })
}

export function useFilteredDepositAssets() {
  const assets = useDepositAssets()
  const findChain = useFindSkipChain()
  const { data: balances, isLoading } = useAllBalancesQuery()

  const data = assets
    .map((asset) => {
      const chain = findChain(asset.chain_id)
      if (!chain) return null
      // filter out external cosmos chains (different wallet connection is required)
      if (chain.chain_type === "cosmos" && chain.bech32_prefix !== "init") return null

      const balance = balances?.[chain.chain_id][asset.denom]
      if (!balance || !Number(balance.amount)) return null

      return { asset, chain, balance }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)

  return { data, isLoading }
}

interface DepositForm {
  quantity: string
  srcDenom: string
  srcChainId: string
  dstDenom: string
  dstChainId: string
}

export function useDepositForm() {
  return useFormContext<DepositForm>()
}
