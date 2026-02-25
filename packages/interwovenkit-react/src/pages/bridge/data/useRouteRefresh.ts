import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { normalizeError } from "@/data/http"
import { useLocationState, useNavigate } from "@/lib/router"
import type { FormValues } from "./form"
import { buildRouteRefreshLocationState } from "./locationState"
import type { RouterRouteResponseJson } from "./simulate"
import { fetchRoute } from "./simulate"
import { useSkip } from "./skip"
import { BridgeType, getBridgeType } from "./tx"

const ROUTE_MAX_AGE_MS = 10_000

function toDeterministicString(value: unknown): string {
  if (value === undefined) return "undefined"
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(toDeterministicString).join(",")}]`
  return `{${Object.entries(value)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${toDeterministicString(v)}`)
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

export function useRouteRefresh(
  route: RouterRouteResponseJson,
  values: FormValues,
  quoteVerifiedAt?: number,
) {
  const navigate = useNavigate()
  const state = useLocationState<Record<string, unknown>>()
  const queryClient = useQueryClient()
  const skip = useSkip()
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

  const refreshRouteIfNeeded = async (): Promise<boolean> => {
    const verifiedAt = Math.max(quoteVerifiedAt ?? 0, lastVerifiedAt)
    if (Date.now() - verifiedAt <= ROUTE_MAX_AGE_MS) return false

    setIsRefreshing(true)
    setRefreshError(undefined)
    const abortController = new AbortController()
    abortControllerRef.current = abortController
    try {
      const refreshedRoute = await fetchRoute(skip, queryClient, values, {
        isOpWithdraw: getBridgeType(route) === BridgeType.OP_WITHDRAW,
        signal: abortController.signal,
      })
      if (abortController.signal.aborted) return true

      const routeChanged = getRouteSignature(refreshedRoute) !== getRouteSignature(route)
      const refreshedAt = Date.now()
      if (routeChanged) {
        navigate(
          0,
          buildRouteRefreshLocationState({
            currentState: state,
            route: refreshedRoute,
            values,
            quoteVerifiedAt: refreshedAt,
          }),
        )
        return true
      }

      setLastVerifiedAt(refreshedAt)
      return false
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return true
      if (abortController.signal.aborted) return true
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

  return {
    refreshRouteIfNeeded,
    isRefreshing,
    refreshError,
    clearRefreshError: () => setRefreshError(undefined),
  }
}
