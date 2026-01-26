import { useEffect, useEffectEvent } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useIsTestnet } from "@/pages/bridge/data/form"
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
  isLoading: true,
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
  const isTestnet = useIsTestnet()

  /**
   * Handle balance events from SSE (updates map only, no query update)
   */
  const handleBalances = useEffectEvent(
    (event: SSEBalanceEvent, balancesMap: Map<string, ChainBalanceData>) => {
      const balances = Array.isArray(event.balances) ? event.balances : []
      balancesMap.set(event.chain, {
        chainName: event.chain,
        chainId: event.chainId,
        balances,
      })
    },
  )

  /**
   * Handle position events from SSE (updates map only, no query update)
   */
  const handlePositions = useEffectEvent(
    (event: SSEPositionEvent, positionsMap: Map<string, ChainPositionData>) => {
      const positions = Array.isArray(event.positions) ? event.positions : []
      positionsMap.set(event.chain, {
        chainName: event.chain,
        chainId: event.chainId,
        positions,
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
      })
    },
  )

  useEffect(() => {
    // Skip SSE connection on testnet - Minity doesn't support testnet
    if (!address || isTestnet) {
      return
    }

    const queryKey = minityQueryKeys.ssePortfolio(address, minityUrl).queryKey

    // Seed maps with existing cached data so chains don't disappear during reconnects
    const existingData = queryClient.getQueryData<SSEPortfolioData>(queryKey)
    const balancesMap = new Map<string, ChainBalanceData>()
    const positionsMap = new Map<string, ChainPositionData>()

    for (const balanceData of existingData?.balances ?? []) {
      balancesMap.set(balanceData.chainName, balanceData)
    }

    for (const positionData of existingData?.positions ?? []) {
      positionsMap.set(positionData.chainName, positionData)
    }

    const baseUrl = minityUrl
    const url = `${baseUrl}/v1/chain/all/${encodeURIComponent(address)}`

    let eventSource: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let reconnectAttempt = 0
    let stopped = false

    const setConnectingState = () => {
      const existing = queryClient.getQueryData<SSEPortfolioData>(queryKey)
      queryClient.setQueryData(queryKey, {
        balances: existing?.balances ?? [],
        positions: existing?.positions ?? [],
        isLoading: true,
        isComplete: false,
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
          scheduleReconnect()
        }
      }

      eventSource.onerror = () => {
        scheduleReconnect()
      }
    }

    connect()

    return () => {
      cleanup()
    }
    // Re-run when address or network changes
    // minityUrl and queryClient accessed via useEffectEvent handlers (always read latest values)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, isTestnet])
}
