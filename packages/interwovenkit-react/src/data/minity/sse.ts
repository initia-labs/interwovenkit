import { useEffect, useEffectEvent } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useInitiaAddress } from "@/public/data/hooks"
import { useConfig } from "../config"
import { SSE_RECONNECT_BASE_DELAY, SSE_RECONNECT_MAX_DELAY } from "./client"
import { minityQueryKeys } from "./query-keys"
import type {
  ChainBalanceData,
  ChainPositionData,
  SSEBalanceEvent,
  SSEEvent,
  SSEPortfolioData,
  SSEPositionEvent,
} from "./types"

// ============================================
// DEFAULT DATA
// ============================================

const DEFAULT_SSE_DATA: SSEPortfolioData = {
  balances: [],
  positions: [],
  isLoading: false,
  isComplete: false,
}

// ============================================
// SSE HOOK
// ============================================

/**
 * Hook to establish SSE connection for portfolio data streaming.
 * Should be called ONCE at the app level (e.g., in a provider or layout).
 * Uses useEffectEvent to ensure handlers read latest values without causing reconnection.
 */
export function usePortfolioSSE() {
  const queryClient = useQueryClient()
  const address = useInitiaAddress()
  const { minityUrl } = useConfig()

  /**
   * Handle balance events from SSE
   */
  const handleBalances = useEffectEvent(
    (event: SSEBalanceEvent, balancesMap: Map<string, ChainBalanceData>) => {
      const queryKey = minityQueryKeys.ssePortfolio(address ?? "", minityUrl).queryKey
      // Ensure balances is always an array (defensive check for malformed API response)
      const balances = Array.isArray(event.balances) ? event.balances : []
      balancesMap.set(event.chain, {
        chainName: event.chain,
        chainId: event.chainId,
        balances,
      })
      const current = queryClient.getQueryData<SSEPortfolioData>(queryKey) ?? DEFAULT_SSE_DATA
      queryClient.setQueryData(queryKey, {
        ...current,
        balances: Array.from(balancesMap.values()),
      })
    },
  )

  /**
   * Handle position events from SSE
   */
  const handlePositions = useEffectEvent(
    (event: SSEPositionEvent, positionsMap: Map<string, ChainPositionData>) => {
      const queryKey = minityQueryKeys.ssePortfolio(address ?? "", minityUrl).queryKey
      // Ensure positions is always an array (defensive check for malformed API response)
      const positions = Array.isArray(event.positions) ? event.positions : []
      positionsMap.set(event.chain, {
        chainName: event.chain,
        chainId: event.chainId,
        positions,
      })
      const current = queryClient.getQueryData<SSEPortfolioData>(queryKey) ?? DEFAULT_SSE_DATA
      queryClient.setQueryData(queryKey, {
        ...current,
        positions: Array.from(positionsMap.values()),
      })
    },
  )

  /**
   * Update cache with latest streamed data.
   * Stream is long-lived; we no longer try to mark completion. isLoading flips
   * to false once we have seen any data chunk (balances or positions).
   */
  const updateAggregated = useEffectEvent(
    (balancesMap: Map<string, ChainBalanceData>, positionsMap: Map<string, ChainPositionData>) => {
      const queryKey = minityQueryKeys.ssePortfolio(address ?? "", minityUrl).queryKey
      const current = queryClient.getQueryData<SSEPortfolioData>(queryKey) ?? DEFAULT_SSE_DATA
      const hasData = balancesMap.size > 0 || positionsMap.size > 0
      queryClient.setQueryData(queryKey, {
        ...current,
        balances: Array.from(balancesMap.values()),
        positions: Array.from(positionsMap.values()),
        isLoading: hasData ? false : current.isLoading,
        isComplete: false,
        completedAt: undefined,
      })
    },
  )

  useEffect(() => {
    if (!address) {
      return
    }

    const queryKey = minityQueryKeys.ssePortfolio(address, minityUrl).queryKey

    // Seed maps with existing cached data so chains don't disappear during reconnects
    const existingData = queryClient.getQueryData<SSEPortfolioData>(queryKey)
    const balancesMap = new Map<string, ChainBalanceData>()
    const positionsMap = new Map<string, ChainPositionData>()

    for (const b of existingData?.balances ?? []) {
      balancesMap.set(b.chainName, b)
    }

    for (const p of existingData?.positions ?? []) {
      positionsMap.set(p.chainName, p)
    }

    const baseUrl = minityUrl
    const url = `${baseUrl}/v1/chain/all/${encodeURIComponent(address)}`

    let eventSource: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let reconnectAttempt = 0
    let stopped = false
    let hasLoggedParseError = false

    const setConnectingState = () => {
      const existing = queryClient.getQueryData<SSEPortfolioData>(queryKey)
      queryClient.setQueryData(queryKey, {
        balances: existing?.balances ?? [],
        positions: existing?.positions ?? [],
        isLoading: true,
        isComplete: false,
        completedAt: undefined,
      })
    }

    const cleanup = () => {
      stopped = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      if (eventSource) {
        eventSource.close()
        eventSource = null
      }
    }

    const scheduleReconnect = () => {
      if (stopped) return
      if (reconnectTimer) return
      setConnectingState()
      const delay = Math.min(
        SSE_RECONNECT_MAX_DELAY,
        SSE_RECONNECT_BASE_DELAY * 2 ** reconnectAttempt,
      )
      reconnectAttempt += 1
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        connect()
      }, delay)
    }

    const connect = () => {
      if (stopped) return
      setConnectingState()

      if (eventSource) {
        eventSource.close()
      }

      eventSource = new EventSource(url)

      eventSource.onopen = () => {
        reconnectAttempt = 0
        hasLoggedParseError = false
      }

      eventSource.onmessage = (event) => {
        if (stopped) return
        try {
          const parsed = JSON.parse(event.data) as SSEEvent
          if (parsed.type === "balances") {
            handleBalances(parsed as SSEBalanceEvent, balancesMap)
          } else if (parsed.type === "positions") {
            handlePositions(parsed as SSEPositionEvent, positionsMap)
          }
          updateAggregated(balancesMap, positionsMap)
        } catch {
          if (!hasLoggedParseError) {
            hasLoggedParseError = true
          }
          scheduleReconnect()
        }
      }

      eventSource.onerror = () => {
        scheduleReconnect()
      }

      eventSource.addEventListener("close", () => {
        scheduleReconnect()
      })
    }

    connect()

    return () => {
      cleanup()
    }
    // Re-run when address changes (user connects/disconnects wallet)
    // minityUrl and queryClient accessed via useEffectEvent handlers (always read latest values)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address])
}
