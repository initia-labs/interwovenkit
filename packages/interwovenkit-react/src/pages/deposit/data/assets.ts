import type { KyInstance } from "ky"
import { useCallback, useEffect, useMemo, useState } from "react"
import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { useInitiaRegistry } from "@/data/chains"
import { useConfig } from "@/data/config"
import { normalizeError, STALE_TIMES } from "@/data/http"
import { depositQueryKeys, useDepositApi } from "./api"
import { normalizeDenom } from "./assetOptions"
import { findDestinationNetwork } from "./source"
import type { Asset, ListAssetsResponse } from "./types"

// Missing `processing_time_seconds` is usually transient: a cold backend cache
// responds without it while refreshing the router estimate in the background.
// Retry on a short interval, capped at ~30 s (initial fetch + 6 refetches) so a
// down router-api doesn't poll forever; past the cap the UI shows "Unavailable".
const PROCESSING_TIME_REFETCH_INTERVAL = 5_000
const PROCESSING_TIME_FETCH_LIMIT = 7

function hasMissingProcessingTime(assets: Asset[]): boolean {
  return assets.some((asset) =>
    asset.dst_networks.some((network) => network.processing_time_seconds === undefined),
  )
}

// Boundary guard for the `.json<ListAssetsResponse>()` cast, scoped to the
// values protecting funds: `min_deposit_amount` (a payout below it strands the
// deposit with no refund) and `src_decimals` (both the displayed minimum and
// the gate's payout conversion run through it). The gates built on them
// (isBelowRouteMinimum, formatSourceMin) silently disarm or mis-render on a
// malformed value (`BigNumber.lt("")`/`lt(0)` never trips; missing decimals
// render base units as whole tokens), and backend schema drift is a realistic
// source of both — so fail loudly here instead, surfaced through the method
// hub's local boundary (Retry), degrading only the address/onramp methods.
export function parseAssets(assets: Asset[]): Asset[] {
  for (const asset of assets) {
    if (!/^\d+$/.test(asset.min_deposit_amount)) {
      throw new Error(
        `Invalid min_deposit_amount "${asset.min_deposit_amount}" for route ${asset.src_chain_id}:${asset.src_denom}`,
      )
    }
    if (!Number.isInteger(asset.src_decimals) || asset.src_decimals < 0) {
      throw new Error(
        `Invalid src_decimals "${asset.src_decimals}" for route ${asset.src_chain_id}:${asset.src_denom}`,
      )
    }
  }
  return assets
}

/** Display shape for a receive asset on a specific destination chain. */
export interface ReceiveAsset {
  symbol: string
  denom: string
  chainId: string
  chainName: string
  logoUrl: string
  chainLogoUrl: string
}

/**
 * GET /v1/config/assets. Near-static route config, so cache long — `gcTime`
 * matches `staleTime` (an hour, see STALE_TIMES.INFINITY) so re-entering the
 * deposit flow within that window reads the cache instead of suspending.
 *
 * Shared by the suspense hook below and usePrefetchDepositAssets, so both
 * resolve the same cache entry.
 */
export function createDepositAssetsQueryOptions(api: KyInstance) {
  return queryOptions({
    queryKey: depositQueryKeys.assets.queryKey,
    queryFn: async (): Promise<Asset[]> => {
      try {
        const { assets } = await api.get("v1/config/assets").json<ListAssetsResponse>()
        return parseAssets(assets)
      } catch (error) {
        throw await normalizeError(error)
      }
    },
    staleTime: STALE_TIMES.INFINITY,
    gcTime: STALE_TIMES.INFINITY,
    // prefetchQuery forces `retry: false` when unset, so a transient prefetch
    // failure would park a cached error the hub's suspense mount rethrows
    // without refetching (no QueryErrorResetBoundary, so retryOnMount is forced
    // off for suspense). Explicit retry keeps prefetch on the same budget as a
    // mount-driven fetch.
    retry: 3,
    // See PROCESSING_TIME_REFETCH_INTERVAL: retry only while an estimate is
    // missing and the fetch budget remains. `dataUpdateCount` persists in the
    // cache, so the cap survives modal close/reopen within the session.
    refetchInterval: (query) =>
      query.state.data &&
      hasMissingProcessingTime(query.state.data) &&
      query.state.dataUpdateCount < PROCESSING_TIME_FETCH_LIMIT
        ? PROCESSING_TIME_REFETCH_INTERVAL
        : false,
  })
}

/**
 * Suspense query. Under the method hub the surrounding AsyncBoundary is local
 * (see SelectDepositMethod): a failure only degrades the address/onramp
 * methods, never the hub itself. The hub gates on `depositApiUrl`, so this only
 * runs when the Deposit API is configured.
 */
export function useDepositAssetsQuery() {
  const api = useDepositApi()
  return useSuspenseQuery(createDepositAssetsQueryOptions(api))
}

/**
 * Prefetches `config/assets` so the method hub renders with availability
 * already resolved, instead of mounting its address/onramp methods disabled
 * behind the suspense fallback until the response lands. Fired by useOpenDeposit
 * to overlap the asset-picker step (or modal opening for a single preset asset).
 * No-op when the Deposit API is not configured. Errors are ignored: a failed
 * prefetch parks the query in error state, which the hub's suspense mount
 * rethrows into its local boundary; Retry or re-entering the flow refetches.
 */
export function usePrefetchDepositAssets() {
  const { depositApiUrl } = useConfig()
  const api = useDepositApi()
  const queryClient = useQueryClient()
  return useCallback(() => {
    if (!depositApiUrl) return
    void queryClient.prefetchQuery(createDepositAssetsQueryOptions(api))
  }, [depositApiUrl, api, queryClient])
}

/** Display state of a route's processing-time estimate for a destination. */
export type ProcessingTimeEstimate =
  | { status: "ready"; seconds: number }
  | { status: "estimating" }
  | { status: "unavailable" }

/**
 * The processing-time estimate for (route -> receive network), resolved to a
 * display state: `ready` when present, `estimating` while the missing-estimate
 * retry window is open, `unavailable` once it closes.
 *
 * The estimating -> unavailable flip runs on a local deadline, not query state:
 * refetches returning identical data are structurally shared and cause no
 * re-render, so query state alone could leave "estimating" up forever. The
 * cached fetch count still short-circuits to `unavailable` when the screen
 * mounts after the retry budget was already spent (no refetch is coming).
 */
export function useProcessingTime(
  route: Asset | undefined,
  chainId: string,
  denom: string,
): ProcessingTimeEstimate {
  useDepositAssetsQuery() // subscribe so refetched data flows into `route`
  const queryClient = useQueryClient()
  const fetchCount =
    queryClient.getQueryState(depositQueryKeys.assets.queryKey)?.dataUpdateCount ?? 0

  const seconds = route
    ? findDestinationNetwork(route, chainId, denom)?.processing_time_seconds
    : undefined

  const [deadlinePassed, setDeadlinePassed] = useState(false)
  useEffect(() => {
    if (seconds !== undefined) return
    const remainingFetches = Math.max(0, PROCESSING_TIME_FETCH_LIMIT - fetchCount)
    const timer = setTimeout(
      () => setDeadlinePassed(true),
      remainingFetches * PROCESSING_TIME_REFETCH_INTERVAL,
    )
    return () => clearTimeout(timer)
  }, [seconds, fetchCount])

  if (seconds !== undefined) return { status: "ready", seconds }
  return deadlinePassed || fetchCount >= PROCESSING_TIME_FETCH_LIMIT
    ? { status: "unavailable" }
    : { status: "estimating" }
}

export interface ReceiveAssets {
  /** Symbol-level entries for the entry picker. */
  assets: ReceiveAsset[]
  /** Chain-level entries (one per destination network) for the refine picker. */
  chainAssets: ReceiveAsset[]
}

/**
 * Receive-asset options for the pickers, derived only from `config/assets`.
 * Each destination network becomes one chain-level entry; the entry picker
 * shows one representative per symbol (preferring the default chain). Logos
 * resolve from the registry (chain) and the registry CDN (asset).
 */
export function useReceiveAssets(): ReceiveAssets {
  const { registryUrl, defaultChainId } = useConfig()
  const { data } = useDepositAssetsQuery()
  const registry = useInitiaRegistry()

  return useMemo(() => {
    const findChain = (chainId: string) => registry.find((chain) => chain.chain_id === chainId)

    const chainAssets: ReceiveAsset[] = data.flatMap((asset) =>
      asset.dst_networks
        .filter((network) => network.vm_type !== "not_supported")
        .map((network) => {
          const chain = findChain(network.chain_id)
          return {
            symbol: asset.dst_symbol,
            denom: network.denom,
            chainId: network.chain_id,
            chainName: chain?.pretty_name || chain?.chain_name || network.chain_name,
            logoUrl: `${registryUrl}/images/${asset.dst_symbol}.png`,
            chainLogoUrl: chain?.logo_URIs?.png ?? "",
          }
        }),
    )

    // One representative entry per symbol for the entry picker, preferring the
    // default chain so the initial selection lands on L1 when offered.
    const bySymbol = new Map<string, ReceiveAsset>()
    for (const chainAsset of chainAssets) {
      const existing = bySymbol.get(chainAsset.symbol)
      const preferred =
        chainAsset.chainId === defaultChainId && existing?.chainId !== defaultChainId
      if (!existing || preferred) bySymbol.set(chainAsset.symbol, chainAsset)
    }

    return { assets: [...bySymbol.values()], chainAssets }
  }, [data, registry, registryUrl, defaultChainId])
}

/**
 * The route (source asset) matching a (src_chain_id, src_denom) pair, e.g. to
 * resolve `src_decimals` for a discovered deposit. Undefined when the route is
 * no longer in the Deposit API's `config/assets` (routes can be removed while
 * old deposits remain).
 */
export function useSourceRoute(srcChainId: string, srcDenom: string): Asset | undefined {
  const { data } = useDepositAssetsQuery()
  return data.find((asset) => asset.src_chain_id === srcChainId && asset.src_denom === srcDenom)
}

/**
 * The supported source routes that feed a destination (chain, denom). A single
 * destination can be fed by more than one source asset; each carries its own
 * `min_deposit_amount` (in that source's denom units).
 */
export function useDepositRoutes(chainId: string, assetDenom: string): Asset[] {
  const { data } = useDepositAssetsQuery()
  return useMemo(
    () =>
      // host vs Skip casing — see normalizeDenom
      data.filter((asset) =>
        asset.dst_networks.some(
          (network) =>
            network.chain_id === chainId &&
            normalizeDenom(network.denom) === normalizeDenom(assetDenom),
        ),
      ),
    [data, chainId, assetDenom],
  )
}

interface ReceiveAssetSelection {
  denom: string
  chainId: string
  symbol: string
}

/**
 * Resolves the display asset for a form selection, matching on (denom, chain)
 * only: a symbol-level fallback could pick the same symbol on a different chain
 * and render a plausible-but-wrong chain name. Falls back to a minimal entry
 * from the selection itself, so a stale selection still renders its symbol with
 * the chain fields empty.
 */
export function useReceiveAsset({ denom, chainId, symbol }: ReceiveAssetSelection): ReceiveAsset {
  const { chainAssets } = useReceiveAssets()
  return useMemo(() => {
    return (
      // host vs Deposit API `config/assets` casing — see normalizeDenom
      chainAssets.find(
        (asset) =>
          normalizeDenom(asset.denom) === normalizeDenom(denom) && asset.chainId === chainId,
      ) ?? {
        symbol,
        denom,
        chainId,
        chainName: "",
        logoUrl: "",
        chainLogoUrl: "",
      }
    )
  }, [chainAssets, denom, chainId, symbol])
}
