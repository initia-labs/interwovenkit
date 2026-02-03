import BigNumber from "bignumber.js"
import ky from "ky"
import { useMemo } from "react"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { useConfig } from "@/data/config"
import type { FormValues } from "./form"

export const skipQueryKeys = createQueryKeys("interwovenkit:skip", {
  chains: null,
  allAssets: () => ["allAssets"],
  assets: (chainId: string) => [chainId],
  asset: (chainId: string, denom: string) => [chainId, denom],
  allBalances: (chainIds: string[], addresses: string[]) => [chainIds, addresses],
  balances: (chainId: string, address: string) => [chainId, address],
  route: (values: FormValues, isOpWithdraw?: boolean) => [
    { ...values, quantity: BigNumber(values.quantity || 0).toString() },
    isOpWithdraw,
  ],
  routeErrorInfo: (error?: Error) => [error],
  txTrack: (chainId: string, txHash?: string) => [chainId, txHash],
  txStatus: (chainId: string, txHash?: string) => [chainId, txHash],
})

export function useSkip() {
  const { routerApiUrl } = useConfig()
  return useMemo(() => ky.create({ prefixUrl: routerApiUrl }), [routerApiUrl])
}
