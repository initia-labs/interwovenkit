import type { KyInstance } from "ky"
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

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/

// Boundary parser for the Deposit API response. The address is
// where the user (or Onramper) irrevocably sends funds with no refund, so it is
// held to the same standard as assertDepositsAtAddress: the address must be a
// 20-byte hex EVM address, and the echoed
// destination triple must be the one requested — a mismatch means the server
// derived an address for a different destination, which must fail loudly before
// display. Denom compares through normalizeDenom (EVM casing), wallet
// case-insensitively (server-normalized); chain id is exact.
export function assertDepositAddress(
  response: unknown,
  request: DepositAddressParams,
): DepositAddressResponse {
  if (!response || typeof response !== "object") {
    throw new Error("Deposit address response is not an object")
  }

  const { deposit_address, chain_id, asset_denom, wallet_address, cursor } = response as Record<
    string,
    unknown
  >
  if (typeof deposit_address !== "string" || !EVM_ADDRESS_PATTERN.test(deposit_address)) {
    throw new Error(
      `Deposit address response has an invalid deposit address: ${String(deposit_address)}`,
    )
  }
  if (chain_id !== request.chainId) {
    throw new Error(`Deposit address response chain_id mismatch: ${String(chain_id)}`)
  }
  if (
    typeof asset_denom !== "string" ||
    normalizeDenom(asset_denom) !== normalizeDenom(request.assetDenom)
  ) {
    throw new Error(`Deposit address response asset_denom mismatch: ${String(asset_denom)}`)
  }
  if (
    typeof wallet_address !== "string" ||
    wallet_address.toLowerCase() !== request.walletAddress.toLowerCase()
  ) {
    throw new Error(`Deposit address response wallet_address mismatch: ${String(wallet_address)}`)
  }
  // An empty or missing cursor keeps the detection query (useNewDeposits)
  // disabled, so the advance screens would silently never advance after funds
  // are sent. Same silent-failure standard as the empty-address guard above.
  if (typeof cursor !== "string" || !cursor) {
    throw new Error("Deposit address response is missing the cursor")
  }
  return { deposit_address, chain_id, asset_denom, wallet_address, cursor }
}

// Shared key/fetcher for both address hooks below. The fresh variant reuses the
// cache entry internally but withholds its data until the cursor is reissued.
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
          .json<unknown>()
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
  /** The shared address query; its `data` may predate this mount. */
  query: UseQueryResult<DepositAddressResponse>
  /** Address response fetched successfully after this screen mounted. */
  data: DepositAddressResponse | undefined
  /**
   * Cursor from a fetch that succeeded after this mount; empty string until
   * then (and after a failed refetch), which keeps the detection query
   * disabled.
   */
  freshCursor: string
}

interface SelectFreshDepositAddressParams {
  data: DepositAddressResponse | undefined
  /** React Query marks both successful and failed mount refetches as fetched after mount. */
  isFetchedAfterMount: boolean
  /** A failed refetch can retain cached data, so success must be checked separately. */
  isSuccess: boolean
}

/**
 * Selects the address response the screen may use. Cached data is withheld
 * until this observer completes a successful fetch after mount; a failed
 * refetch can set `isFetchedAfterMount` while retaining the cached response.
 */
export function selectFreshDepositAddress({
  data,
  isFetchedAfterMount,
  isSuccess,
}: SelectFreshDepositAddressParams) {
  return data && isFetchedAfterMount && isSuccess ? data : undefined
}

/**
 * useDepositAddress variant for the screens that start deposit detection (the
 * address screen and the onramp processing screen). The server reissues the
 * `cursor` watermark on every POST, and detection must use a mount-fresh one: a
 * cached cursor predates the deposit just completed at this reused address, so
 * it would pass the `after` filter and bounce "Make another transfer" straight
 * back to tracking.
 *
 * - `refetchOnMount: "always"` reissues the cursor per mount. Cached data stays
 *   internal to the query until that refetch succeeds, so neither the QR nor
 *   checkout can race ahead of cursor issuance.
 * - `isFetchedAfterMount` is paired with `isSuccess`: the former also turns
 *   true on a failed refetch that retains stale cached data.
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
  const query = useQuery({
    ...depositAddressQuery(api, params),
    enabled: !!depositApiUrl && !!walletAddress && !!chainId && !!assetDenom,
    staleTime: Infinity,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const data = selectFreshDepositAddress({
    data: query.data,
    isFetchedAfterMount: query.isFetchedAfterMount,
    isSuccess: query.isSuccess,
  })
  return { query, data, freshCursor: data?.cursor ?? "" }
}
