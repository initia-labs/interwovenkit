import type { OperationJson, RouteResponseJson } from "@skip-go/client"
import BigNumber from "bignumber.js"
import { HTTPError } from "ky"
import type { QueryClient } from "@tanstack/react-query"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toBaseUnit } from "@initia/utils"
import { useAnalyticsTrack } from "@/data/analytics"
import { useInitiaRegistry, useLayer1 } from "@/data/chains"
import type { RouterAsset } from "./assets"
import { useSkipAsset } from "./assets"
import { useChainType, useSkipChain } from "./chains"
import { useBridgeForm } from "./form"
import { skipQueryKeys, useSkip } from "./skip"

export interface RouterRouteResponseJson extends RouteResponseJson {
  operations: OperationJson[]
  required_op_hook?: boolean
  extra_infos?: string[]
  extra_warnings?: string[]
}

export function fetchRoute(
  skip: ReturnType<typeof useSkip>,
  queryClient: QueryClient,
  values: {
    srcChainId: string
    srcDenom: string
    dstChainId: string
    dstDenom: string
    quantity: string
  },
  options?: { isOpWithdraw?: boolean; signal?: AbortSignal },
) {
  const { srcChainId, srcDenom, quantity, dstChainId, dstDenom } = values
  const srcAsset = queryClient.getQueryData<RouterAsset>(
    skipQueryKeys.asset(srcChainId, srcDenom).queryKey,
  )
  if (!srcAsset || srcAsset.decimals == null) {
    throw new Error("Failed to refresh route: source asset metadata is unavailable.")
  }
  const srcDecimals = srcAsset.decimals

  return skip
    .post("v2/fungible/route", {
      signal: options?.signal,
      json: {
        amount_in: toBaseUnit(quantity, { decimals: srcDecimals }),
        source_asset_chain_id: srcChainId,
        source_asset_denom: srcDenom,
        dest_asset_chain_id: dstChainId,
        dest_asset_denom: dstDenom,
        is_op_withdraw: options?.isOpWithdraw,
      },
    })
    .json<RouterRouteResponseJson>()
}

export function useRouteQuery(
  debouncedQuantity: string,
  opWithdrawal?: { isOpWithdraw?: boolean; disabled?: boolean; refreshMs?: number },
) {
  const { watch } = useBridgeForm()
  const values = watch()
  const skip = useSkip()
  const track = useAnalyticsTrack()

  const debouncedValues = { ...values, quantity: debouncedQuantity }
  const isDisabled =
    !values.srcChainId || !values.srcDenom || !values.dstChainId || !values.dstDenom
  const quantityBn = BigNumber(debouncedValues.quantity || 0)
  const isQuantityValid = quantityBn.isFinite() && quantityBn.gt(0)
  const refreshMs = opWithdrawal?.refreshMs ?? 10_000
  const enabled = isQuantityValid && !opWithdrawal?.disabled && !isDisabled

  const queryClient = useQueryClient()
  return useQuery({
    // eslint-disable-next-line @tanstack/query/exhaustive-deps -- skip and queryClient are stable refs
    queryKey: skipQueryKeys.route(debouncedValues, opWithdrawal?.isOpWithdraw).queryKey,
    queryFn: async () => {
      // This query may produce specific errors that need separate handling.
      // Therefore, we do not use try-catch or normalizeError here.
      const response = await fetchRoute(skip, queryClient, debouncedValues, {
        isOpWithdraw: opWithdrawal?.isOpWithdraw,
      })

      track("Bridge Simulation Success", {
        quantity: debouncedValues.quantity,
        srcChainId: debouncedValues.srcChainId,
        srcDenom: debouncedValues.srcDenom,
        dstChainId: debouncedValues.dstChainId,
        dstDenom: debouncedValues.dstDenom,
      })

      return response
    },
    enabled,
    staleTime: refreshMs,
    refetchInterval: enabled ? refreshMs : false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: "always",
  })
}

export function useRouteErrorInfo(error: Error | null) {
  return useQuery({
    queryKey: skipQueryKeys.routeErrorInfo(error ?? undefined).queryKey,
    queryFn: async () => {
      if (!error) return null
      if (!(error instanceof HTTPError)) return null
      const { response } = error
      const contentType = response.headers.get("content-type") ?? ""
      if (!contentType.includes("application/json")) return null
      const data = await response.json()
      return data.info ?? null
    },
    enabled: !!error,
  })
}

export function useIsOpWithdrawable() {
  const { watch } = useBridgeForm()
  const { srcChainId, srcDenom, dstChainId, dstDenom } = watch()
  const srcChain = useSkipChain(srcChainId)
  const srcChainType = useChainType(srcChain)
  const srcAsset = useSkipAsset(srcDenom, srcChainId)
  const dstAsset = useSkipAsset(dstDenom, dstChainId)

  const layer1 = useLayer1()
  const chains = useInitiaRegistry()
  return (
    srcChainType === "initia" &&
    dstChainId === layer1.chainId &&
    srcAsset.symbol === dstAsset.symbol &&
    chains
      .find((chain) => chain.chainId === srcChainId)
      ?.metadata?.op_denoms?.includes(dstAsset.denom)
  )
}
