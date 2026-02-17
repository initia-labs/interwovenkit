import type { StdFee } from "@cosmjs/stargate"
import type { TxJson } from "@skip-go/client"
import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toBaseUnit } from "@initia/utils"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import FormHelp from "@/components/form/FormHelp"
import { normalizeError } from "@/data/http"
import { useNavigate } from "@/lib/router"
import type { RouterAsset } from "./data/assets"
import type { RouterRouteResponseJson } from "./data/simulate"
import { skipQueryKeys, useSkip } from "./data/skip"
import {
  type BridgeTxResult,
  BridgeType,
  getBridgeType,
  useBridgePreviewState,
  useBridgeTx,
} from "./data/tx"

interface Props {
  tx: TxJson
  fee?: StdFee
  onCompleted?: (result: BridgeTxResult) => void
  confirmMessage?: string
  error?: string
}

const ROUTE_MAX_AGE_MS = 10_000

function toDeterministicString(value: unknown): string {
  if (value === undefined) return "undefined"
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(toDeterministicString).join(",")}]`
  return `{${Object.entries(value)
    .toSorted(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .map(([key, nestedValue]) => `${JSON.stringify(key)}:${toDeterministicString(nestedValue)}`)
    .join(",")}}`
}

function getRouteSignature(route: RouterRouteResponseJson) {
  return toDeterministicString({
    amount_in: route.amount_in,
    amount_out: route.amount_out,
    usd_amount_in: route.usd_amount_in,
    usd_amount_out: route.usd_amount_out,
    operations: route.operations,
    estimated_fees: route.estimated_fees,
    estimated_route_duration_seconds: route.estimated_route_duration_seconds,
    warning: route.warning,
    extra_infos: route.extra_infos,
    extra_warnings: route.extra_warnings,
    required_op_hook: route.required_op_hook,
  })
}

function isAbortError(error: unknown) {
  return !!error && typeof error === "object" && "name" in error && error.name === "AbortError"
}

const BridgePreviewFooter = ({ tx, fee, onCompleted, confirmMessage, error }: Props) => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const skip = useSkip()
  const { route, values, quoteVerifiedAt, requiresReconfirm } = useBridgePreviewState()
  const { mutate, isPending } = useBridgeTx(tx, { customFee: fee, onCompleted })
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | undefined>(undefined)
  const [lastVerifiedAt, setLastVerifiedAt] = useState(quoteVerifiedAt ?? 0)
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    setLastVerifiedAt(quoteVerifiedAt ?? 0)
  }, [quoteVerifiedAt])

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  const refreshRouteIfNeeded = async () => {
    const verifiedAt = Math.max(quoteVerifiedAt ?? 0, lastVerifiedAt)
    if (Date.now() - verifiedAt <= ROUTE_MAX_AGE_MS) return false

    setIsRefreshing(true)
    setRefreshError(undefined)
    const abortController = new AbortController()
    abortControllerRef.current = abortController
    try {
      const srcAsset = queryClient.getQueryData<RouterAsset>(
        skipQueryKeys.asset(values.srcChainId, values.srcDenom).queryKey,
      )
      if (!srcAsset || srcAsset.decimals == null) {
        setRefreshError("Failed to refresh route: source asset metadata is unavailable.")
        return true
      }
      const srcDecimals = srcAsset.decimals

      const refreshedRoute = await skip
        .post("v2/fungible/route", {
          signal: abortController.signal,
          json: {
            amount_in: toBaseUnit(values.quantity, { decimals: srcDecimals }),
            source_asset_chain_id: values.srcChainId,
            source_asset_denom: values.srcDenom,
            dest_asset_chain_id: values.dstChainId,
            dest_asset_denom: values.dstDenom,
            is_op_withdraw: getBridgeType(route) === BridgeType.OP_WITHDRAW,
          },
        })
        .json<RouterRouteResponseJson>()
      if (abortController.signal.aborted) return true

      const routeChanged = getRouteSignature(refreshedRoute) !== getRouteSignature(route)
      const refreshedAt = Date.now()
      if (routeChanged) {
        navigate(0, {
          route: refreshedRoute,
          values,
          quoteVerifiedAt: refreshedAt,
          requiresReconfirm: true,
        })
        return true
      }

      setLastVerifiedAt(refreshedAt)
      return false
    } catch (error) {
      if (isAbortError(error) || abortController.signal.aborted) return true
      setRefreshError((await normalizeError(error)).message)
      return true
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null
      }
      if (!abortController.signal.aborted) {
        setIsRefreshing(false)
      }
    }
  }

  const onConfirm = async () => {
    if (isPending || isRefreshing) return

    if (requiresReconfirm) {
      navigate(0, {
        route,
        values,
        quoteVerifiedAt: Math.max(quoteVerifiedAt ?? 0, lastVerifiedAt),
        requiresReconfirm: false,
      })
      return
    }

    if (await refreshRouteIfNeeded()) return

    setRefreshError(undefined)
    mutate()
  }

  const statusMessage =
    error ??
    refreshError ??
    (requiresReconfirm ? "Route updated. Please review and confirm again." : undefined)

  return (
    <Footer
      extra={
        statusMessage && (
          <FormHelp level={error || refreshError ? "error" : "info"}>{statusMessage}</FormHelp>
        )
      }
    >
      <Button.White
        onClick={onConfirm}
        loading={isRefreshing ? "Refreshing route..." : isPending && "Signing transaction..."}
        disabled={!!error}
      >
        {confirmMessage || (requiresReconfirm ? "Confirm updated route" : "Confirm")}
      </Button.White>
    </Footer>
  )
}

export default BridgePreviewFooter
