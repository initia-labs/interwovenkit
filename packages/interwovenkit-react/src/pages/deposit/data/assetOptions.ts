// Local (receive-side) asset options shared by the deposit hub's asset picker
// and the wallet (deposit-via-wallet) subflow.
import { useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { NormalizedAsset } from "@/data/assets"
import { assetQueryKeys } from "@/data/assets"
import { STALE_TIMES } from "@/data/http"
import { useLocationState } from "@/lib/router"
import type { AllAssetsResponse } from "@/pages/bridge/data/assets"
import { skipQueryKeys, useSkip } from "@/pages/bridge/data/skip"

export interface AssetOption {
  denom: string
  chainId: string
}

/** Location state passed by useOpenDeposit/useOpenWithdraw (data/deposit.ts). */
export interface DepositLocationState {
  /** Receive-side (local) assets provided by the host dApp. */
  localOptions?: AssetOption[]
  /** Source-side allowlist provided by the host dApp (srcOptions/dstOptions). */
  remoteOptions?: AssetOption[]
  /** Host-provided recipient override; only the wallet method honors it (see
   * getTransferRecipient). */
  recipientAddress?: string
}

/**
 * Canonical denom form for comparisons: EVM (0x) denoms are case-insensitive
 * hex, and the host dApp's casing can differ from Skip's checksummed casing,
 * so both sides of every denom comparison must go through this.
 */
export function normalizeDenom(denom: string): string {
  return denom.startsWith("0x") ? denom.toLowerCase() : denom
}

/** Non-suspense: renders without suspending. Uses prefetched Skip data when available, falls back to Initia registry cache. */
export function useLocalAssetOptions() {
  const { localOptions = [] } = useLocationState<DepositLocationState>()
  const queryClient = useQueryClient()
  const skip = useSkip()

  const {
    data: skipAssetsRaw,
    isLoading,
    error,
  } = useQuery<AllAssetsResponse>({
    queryKey: skipQueryKeys.allAssets().queryKey,
    queryFn: () => skip.get("v2/fungible/assets").json<AllAssetsResponse>(),
    staleTime: STALE_TIMES.MINUTE,
  })

  // Metadata should resolve once Skip or registry data loads. If timing forces
  // the empty-string fallback, raw denoms (often 60+ hex chars) are unfit for
  // display, so consumers must treat unresolved symbols as loading or error —
  // see SelectAsset.
  const data = useMemo(() => {
    if (skipAssetsRaw) {
      const allAssets = Object.values(skipAssetsRaw.chain_to_assets_map).flatMap(
        (entry) => entry?.assets ?? [],
      )
      const assetMap = new Map(
        allAssets.map((a) => [`${a.chain_id}:${normalizeDenom(a.denom)}`, a]),
      )
      return localOptions.map(({ denom, chainId }) => {
        const asset = assetMap.get(`${chainId}:${normalizeDenom(denom)}`)
        return {
          denom,
          chain_id: chainId,
          symbol: asset?.symbol ?? "",
          logo_uri: asset?.logo_uri ?? "",
        }
      })
    }

    // Fallback: resolve from Initia registry cache while Skip data loads
    return localOptions.map(({ denom, chainId }) => {
      const registryAsset = queryClient.getQueryData<NormalizedAsset>(
        assetQueryKeys.item(chainId, denom).queryKey,
      )
      return {
        denom,
        chain_id: chainId,
        symbol: registryAsset?.symbol ?? "",
        logo_uri: registryAsset?.logoUrl ?? "",
      }
    })
  }, [localOptions, skipAssetsRaw, queryClient])

  return { data, isLoading, error }
}
