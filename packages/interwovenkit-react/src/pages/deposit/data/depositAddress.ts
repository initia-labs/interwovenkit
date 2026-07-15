import type { KyInstance } from "ky"
import { useState } from "react"
import type { UseQueryResult } from "@tanstack/react-query"
import { useQuery } from "@tanstack/react-query"
import { useConfig } from "@/data/config"
import { normalizeError, STALE_TIMES } from "@/data/http"
import { depositQueryKeys, useDepositApi } from "./api"
import { normalizeDenom } from "./assetOptions"
import type { DepositAddressResponse } from "./types"

interface DepositAddressParams {
  /** Destination wallet (connected wallet); normalized server-side. */
  walletAddress: string
  /** Destination chain id. */
  chainId: string
  /** Destination denom (from config/assets dst_networks[].denom). */
  assetDenom: string
}

// Boundary guard for the `.json<DepositAddressResponse>()` cast. The address is
// where the user (or Onramper) irrevocably sends funds with no refund, so it is
// held to the same standard as assertDepositsAtAddress: the address must be
// non-empty (empty renders a blank QR and never matches), and the echoed
// destination triple must be the one requested — a mismatch means the server
// derived an address for a different destination, which must fail loudly before
// display. Denom compares through normalizeDenom (EVM casing), wallet
// case-insensitively (server-normalized); chain id is exact.
export function assertDepositAddress(
  response: DepositAddressResponse,
  request: DepositAddressParams,
): DepositAddressResponse {
  if (!response.deposit_address) {
    throw new Error("Deposit address response is missing the deposit address")
  }
  if (response.chain_id !== request.chainId) {
    throw new Error(`Deposit address response chain_id mismatch: ${response.chain_id}`)
  }
  if (normalizeDenom(response.asset_denom) !== normalizeDenom(request.assetDenom)) {
    throw new Error(`Deposit address response asset_denom mismatch: ${response.asset_denom}`)
  }
  if (response.wallet_address.toLowerCase() !== request.walletAddress.toLowerCase()) {
    throw new Error(`Deposit address response wallet_address mismatch: ${response.wallet_address}`)
  }
  // An empty or missing cursor keeps the detection query (useNewDeposits)
  // disabled, so the advance screens would silently never advance after funds
  // are sent. Same silent-failure standard as the empty-address guard above.
  if (!response.cursor) {
    throw new Error("Deposit address response is missing the cursor")
  }
  return response
}

// Shared key/fetcher for both address hooks below, so the fresh variant reuses
// the same cache entry (address renders instantly from cache while its refetch
// reissues the cursor).
function depositAddressQuery(api: KyInstance, params: DepositAddressParams) {
  const { walletAddress, chainId, assetDenom } = params
  return {
    queryKey: depositQueryKeys.depositAddress(walletAddress, chainId, assetDenom).queryKey,
    queryFn: async () => {
      try {
        const response = await api
          .post("v1/deposit-address", {
            json: {
              wallet_address: walletAddress,
              chain_id: chainId,
              asset_denom: assetDenom,
            },
          })
          .json<DepositAddressResponse>()
        return assertDepositAddress(response, params)
      } catch (error) {
        throw await normalizeError(error)
      }
    },
  }
}

/**
 * POST /v1/deposit-address. Returns the deterministic deposit address for
 * (wallet, destination chain, destination denom). The address is keyed only by
 * the destination and receives any supported source asset, so the result is
 * stable: cache long (a POST reading/issuing an idempotent record still fits a
 * query). Gated on depositApiUrl and a complete destination. Screens that start
 * deposit detection need a mount-fresh cursor and must use
 * useFreshDepositAddress instead.
 */
export function useDepositAddress(params: DepositAddressParams) {
  const { depositApiUrl } = useConfig()
  const api = useDepositApi()
  const { walletAddress, chainId, assetDenom } = params
  return useQuery({
    ...depositAddressQuery(api, params),
    enabled: !!depositApiUrl && !!walletAddress && !!chainId && !!assetDenom,
    staleTime: STALE_TIMES.INFINITY,
  })
}

export interface FreshDepositAddress {
  /** The shared address query; `data` may come from cache so the address renders instantly. */
  query: UseQueryResult<DepositAddressResponse>
  /**
   * Cursor from a fetch that succeeded after this mount; empty string until
   * then (and after a failed refetch), which keeps the detection query
   * disabled.
   */
  freshCursor: string
}

interface SelectFreshCursorParams {
  data: DepositAddressResponse | undefined
  /** React Query's timestamp of the last SUCCESSFUL fetch for this entry. */
  dataUpdatedAt: number
  /** When the consuming screen mounted (same client clock as dataUpdatedAt). */
  mountedAt: number
}

/**
 * Selects the cursor detection may use: only one from a fetch that succeeded
 * after this mount, empty string otherwise. `dataUpdatedAt` advances only on a
 * successful fetch, so after a failed mount refetch the cached (stale) cursor
 * stays unselected — the exact leak `isFetchedAfterMount` would allow (see
 * useFreshDepositAddress).
 */
export function selectFreshCursor({ data, dataUpdatedAt, mountedAt }: SelectFreshCursorParams) {
  return data && dataUpdatedAt >= mountedAt ? data.cursor : ""
}

/**
 * useDepositAddress variant for the screens that start deposit detection (the
 * address screen and the onramp processing screen). The server reissues the
 * `cursor` watermark on every POST, and detection must use a mount-fresh one: a
 * cached cursor predates the deposit just completed at this reused address, so
 * it would pass the `after` filter and bounce "Make another transfer" straight
 * back to tracking.
 *
 * - `refetchOnMount: "always"` reissues the cursor per mount while the cached
 *   address renders immediately (no QR delay).
 * - The cursor is gated on `dataUpdatedAt` reaching this mount's timestamp.
 *   `isFetchedAfterMount` is unusable: it turns true even on a failed refetch,
 *   leaking the cached (stale) cursor.
 * - Background reissue is blocked (focus/reconnect refetch off, real `Infinity`
 *   staleTime — STALE_TIMES.INFINITY is actually 1 hour and the host app's
 *   QueryClient defaults can't be relied on). Otherwise returning to the tab an
 *   hour into staring at the QR would advance the cursor past an already-sent
 *   deposit, filtering it out of detection permanently.
 * - On a failed mount refetch the query reports the error while keeping the
 *   cached address; detection never starts (empty freshCursor), so the screens
 *   surface the failure instead of a QR that cannot detect.
 */
export function useFreshDepositAddress(params: DepositAddressParams): FreshDepositAddress {
  const { depositApiUrl } = useConfig()
  const api = useDepositApi()
  const { walletAddress, chainId, assetDenom } = params
  const [mountedAt] = useState(() => Date.now())
  const query = useQuery({
    ...depositAddressQuery(api, params),
    enabled: !!depositApiUrl && !!walletAddress && !!chainId && !!assetDenom,
    staleTime: Infinity,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const freshCursor = selectFreshCursor({
    data: query.data,
    dataUpdatedAt: query.dataUpdatedAt,
    mountedAt,
  })
  return { query, freshCursor }
}
