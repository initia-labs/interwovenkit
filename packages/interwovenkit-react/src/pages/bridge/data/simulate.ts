import type { OperationJson, RouteResponseJson } from "@skip-go/client"
import BigNumber from "bignumber.js"
import { HTTPError } from "ky"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toBaseUnit } from "@initia/utils"
import { useAnalyticsTrack } from "@/data/analytics"
import { useInitiaRegistry, useLayer1 } from "@/data/chains"
import { STALE_TIMES } from "@/data/http"
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

export function useRouteQuery(
  debouncedQuantity: string,
  opWithdrawal?: { isOpWithdraw?: boolean; disabled?: boolean },
) {
  const { watch } = useBridgeForm()
  const values = watch()
  const skip = useSkip()
  const track = useAnalyticsTrack()

  const debouncedValues = { ...values, quantity: debouncedQuantity }
  const isDisabled =
    !values.srcChainId || !values.srcDenom || !values.dstChainId || !values.dstDenom
  const quantityBn = new BigNumber(debouncedValues.quantity || 0)
  const isQuantityValid = quantityBn.isFinite() && quantityBn.gt(0)

  const queryClient = useQueryClient()
  return useQuery({
    queryKey: skipQueryKeys.route(debouncedValues, opWithdrawal?.isOpWithdraw).queryKey,
    queryFn: async () => {
      // This query may produce specific errors that need separate handling.
      // Therefore, we do not use try-catch or normalizeError here.

      const { srcChainId, srcDenom, quantity, dstChainId, dstDenom } = debouncedValues

      const { decimals: srcDecimals } = queryClient.getQueryData<RouterAsset>(
        skipQueryKeys.asset(srcChainId, srcDenom).queryKey,
      ) ?? { decimals: 0 }

      const params = {
        amount_in: toBaseUnit(quantity, { decimals: srcDecimals }),
        source_asset_chain_id: srcChainId,
        source_asset_denom: srcDenom,
        dest_asset_chain_id: dstChainId,
        dest_asset_denom: dstDenom,
        is_op_withdraw: opWithdrawal?.isOpWithdraw,
      }

      const response = await skip
        .post("v2/fungible/route", { json: params })
        .json<RouterRouteResponseJson>()

      const trackParams = {
        quantity: debouncedValues.quantity,
        srcChainId: debouncedValues.srcChainId,
        srcDenom: debouncedValues.srcDenom,
        dstChainId: debouncedValues.dstChainId,
        dstDenom: debouncedValues.dstDenom,
      }
      track("Bridge Simulation Success", trackParams)

      return response
    },
    enabled: isQuantityValid && !opWithdrawal?.disabled && !isDisabled,
    staleTime: STALE_TIMES.MINUTE,
  })
}

export function useRouteErrorInfo(error: Error | null) {
  return useQuery({
    queryKey: skipQueryKeys.routeErrorInfo(error || new Error()).queryKey,
    queryFn: async () => {
      if (!error) return null
      if (!(error instanceof HTTPError)) return null
      const { response } = error
      const contentType = response.headers.get("content-type") ?? ""
      if (!contentType.includes("application/json")) return null
      const data = await response.json()
      return data.info ?? null
    },
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
