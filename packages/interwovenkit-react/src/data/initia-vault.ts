import BigNumber from "bignumber.js"
import { useMemo } from "react"
import { useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { bcs, createMoveClient, fromBaseUnit, InitiaAddress } from "@initia/utils"
import { useInitiaAddress } from "@/public/data/hooks"
import { useAssets, useDenoms } from "./assets"
import { useLayer1, usePricesQuery } from "./chains"
import { useConfig } from "./config"
import { STALE_TIMES } from "./http"

const VAULT_MODULE = "vault"
const VAULT_STAKING_MODULE = "vault_staking"

// ============================================
// QUERY KEYS
// ============================================

export const initiaVaultQueryKeys = createQueryKeys("interwovenkit:initia-vault", {
  staked: (restUrl: string, moduleAddress: string, address: string) => [
    restUrl,
    moduleAddress,
    address,
  ],
  info: (restUrl: string, moduleAddress: string, vault: string) => [restUrl, moduleAddress, vault],
  shareToAsset: (restUrl: string, moduleAddress: string, vault: string, amount: string) => [
    restUrl,
    moduleAddress,
    vault,
    amount,
  ],
  claimable: (restUrl: string, moduleAddress: string, vault: string, address: string) => [
    restUrl,
    moduleAddress,
    vault,
    address,
  ],
})

// ============================================
// VIEW RESPONSE TYPES (snake_case from chain)
// ============================================

interface StakedToken {
  metadata: string
  amount: string
}

interface VaultInfoView {
  asset_0: string
  asset_1: string
  oracle_price_0: string
  oracle_price_1: string
  is_active: boolean
  curator: string
}

interface RewardAsset {
  metadata: string
  amount: string
}

type ShareToAsset = [string, string]

// ============================================
// DISPLAY TYPES
// ============================================

export interface VaultPositionRow {
  vaultAddress: string
  symbol: string
  coinLogos: string[]
  isActive: boolean
  // Same pool can host vaults from different curators, so the curator disambiguates otherwise
  // identical rows. Stored as a bech32 (init1…) address for the explorer link.
  curatorAddress: string
  /** USD value of the underlying assets. */
  value: number
  /** USD value of the claimable rewards. */
  claimableValue: number
}

export interface VaultSectionData {
  totalValue: number
  rows: VaultPositionRow[]
}

// ============================================
// PER-VAULT QUERY HOOKS
// ============================================

type ViewFunction = ReturnType<typeof createMoveClient>["viewFunction"]

const objectArg = (value: string) => bcs.object().serialize(value).toBase64()
const addressArg = (value: string) => bcs.address().serialize(value).toBase64()

// Each hook uses `combine` so its return value is a referentially stable array of just the data.
// Extracting them into custom hooks (rather than calling useSuspenseQueries inline) also lets the
// caller list these results in a useMemo dependency array — the @tanstack/query/no-unstable-deps
// rule only flags a useSuspenseQueries result used directly, not one returned from a custom hook.

function useVaultInfos(
  staked: StakedToken[],
  restUrl: string,
  moduleAddress: string,
  viewFunction: ViewFunction,
) {
  return useSuspenseQueries({
    queries: staked.map((token) => ({
      queryKey: initiaVaultQueryKeys.info(restUrl, moduleAddress, token.metadata).queryKey,
      queryFn: () =>
        viewFunction<VaultInfoView>({
          moduleAddress,
          moduleName: VAULT_MODULE,
          functionName: "vault_info",
          typeArgs: [],
          args: [objectArg(token.metadata)],
        }),
      staleTime: STALE_TIMES.MINUTE,
    })),
    combine: (results) => results.map((result) => result.data),
  })
}

function useVaultUnderlyings(
  staked: StakedToken[],
  restUrl: string,
  moduleAddress: string,
  viewFunction: ViewFunction,
) {
  return useSuspenseQueries({
    queries: staked.map((token) => ({
      queryKey: initiaVaultQueryKeys.shareToAsset(
        restUrl,
        moduleAddress,
        token.metadata,
        token.amount,
      ).queryKey,
      queryFn: () =>
        viewFunction<ShareToAsset>({
          moduleAddress,
          moduleName: VAULT_MODULE,
          functionName: "vault_share_to_asset",
          typeArgs: [],
          args: [objectArg(token.metadata), bcs.u64().serialize(token.amount).toBase64()],
        }),
      staleTime: STALE_TIMES.MINUTE,
    })),
    combine: (results) => results.map((result) => result.data),
  })
}

function useVaultClaimables(
  staked: StakedToken[],
  restUrl: string,
  moduleAddress: string,
  address: string,
  viewFunction: ViewFunction,
) {
  return useSuspenseQueries({
    queries: staked.map((token) => ({
      queryKey: initiaVaultQueryKeys.claimable(restUrl, moduleAddress, token.metadata, address)
        .queryKey,
      queryFn: () =>
        viewFunction<RewardAsset[]>({
          moduleAddress,
          moduleName: VAULT_MODULE,
          functionName: "user_claimable_rewards",
          typeArgs: [],
          args: [objectArg(token.metadata), addressArg(address)],
        }),
      staleTime: STALE_TIMES.MINUTE,
    })),
    combine: (results) => results.map((result) => result.data ?? []),
  })
}

// ============================================
// HOOK
// ============================================

// The user's staked Initia (dex_clamm_vault) positions, valued via the vault's oracle prices, with
// claimable rewards priced from the asset price feed. Mirrors the app's My-positions vault logic.
export function useInitiaVaultPositions(): VaultSectionData {
  const address = useInitiaAddress()
  const layer1 = useLayer1()
  const { restUrl } = layer1
  const { clammVaultModuleAddress: moduleAddress } = useConfig()
  const { viewFunction } = createMoveClient(restUrl)
  const { data: prices } = usePricesQuery(layer1)
  const assets = useAssets(layer1)

  const { data: staked } = useSuspenseQuery({
    queryKey: initiaVaultQueryKeys.staked(restUrl, moduleAddress, address).queryKey,
    queryFn: async (): Promise<StakedToken[]> => {
      // No connected wallet is the only "empty" case; let real RPC/view failures throw so the
      // AsyncBoundary surfaces them (consistent with the per-vault queries and sibling hooks).
      if (!address) return []
      // Normalize a null/undefined view payload to [] so the downstream `.map` calls can't throw,
      // matching the sibling hooks (e.g. lock-staking's `return result ?? []`).
      const result = await viewFunction<StakedToken[]>({
        moduleAddress,
        moduleName: VAULT_STAKING_MODULE,
        functionName: "user_staked_tokens",
        typeArgs: [],
        args: [addressArg(address)],
      })
      return result ?? []
    },
    staleTime: STALE_TIMES.MINUTE,
  })

  // These return referentially stable data arrays (via `combine`), so the derivation below can be
  // memoized — like the sibling Liquidity/Staking hooks — keyed on them.
  const infoData = useVaultInfos(staked, restUrl, moduleAddress, viewFunction)
  const underlyingData = useVaultUnderlyings(staked, restUrl, moduleAddress, viewFunction)
  const claimableData = useVaultClaimables(staked, restUrl, moduleAddress, address, viewFunction)

  // Resolve fungible-asset metadata addresses to denoms so the pair (and rewards) can be named/priced.
  const assetMetadatas = [
    ...new Set(infoData.flatMap((info) => (info ? [info.asset_0, info.asset_1] : []))),
  ]
  const rewardMetadatas = [
    ...new Set(claimableData.flatMap((rewards) => rewards.map((reward) => reward.metadata))),
  ]
  const denomMap = useDenoms(assetMetadatas, { failSoft: true })
  const rewardDenomMap = useDenoms(rewardMetadatas, { failSoft: true })

  // Memoize the derivation (like the sibling Liquidity/Staking hooks) so the rows/total references
  // stay stable across renders for the 5 call sites that consume this hook.
  return useMemo(() => {
    const assetByDenom = new Map(assets.map((asset) => [asset.denom, asset]))
    const priceOf = (denom: string) => prices?.find((p) => p.id === denom)?.price ?? 0

    const rows = staked
      .map((token, index): VaultPositionRow | null => {
        const info = infoData[index]
        const underlying = underlyingData[index]
        if (!info || !underlying) return null

        // Vault oracle prices are per RAW unit, so multiply the raw underlying amounts directly (no
        // fromBaseUnit) — unlike the reward feed below, which is per DISPLAY unit. Guard the string
        // operands ("" would throw under BigNumber strict mode).
        const value = BigNumber(info.oracle_price_0 || 0)
          .times(underlying[0] || 0)
          .plus(BigNumber(info.oracle_price_1 || 0).times(underlying[1] || 0))
          .toNumber()

        const asset0 = assetByDenom.get(denomMap.get(info.asset_0) ?? "")
        const asset1 = assetByDenom.get(denomMap.get(info.asset_1) ?? "")

        const claimableValue = claimableData[index]
          .reduce((sum, reward) => {
            const denom = rewardDenomMap.get(reward.metadata) ?? ""
            const asset = assetByDenom.get(denom)
            const amount = fromBaseUnit(reward.amount, { decimals: asset?.decimals ?? 6 })
            return sum.plus(BigNumber(amount || 0).times(priceOf(denom)))
          }, BigNumber(0))
          .toNumber()

        return {
          vaultAddress: token.metadata,
          symbol: [asset0?.symbol, asset1?.symbol].filter(Boolean).join("-"),
          coinLogos: [asset0?.logoUrl ?? "", asset1?.logoUrl ?? ""],
          isActive: info.is_active,
          curatorAddress: info.curator ? InitiaAddress(info.curator).bech32 : "",
          value,
          claimableValue,
        }
      })
      .filter((row): row is VaultPositionRow => row !== null)
      // Sort by total worth descending, matching the Liquidity/VIP sections. `.sort` is safe here —
      // the array is freshly built by map/filter (toSorted isn't available under this tsconfig lib).
      .sort((a, b) => b.value + b.claimableValue - (a.value + a.claimableValue))

    const totalValue = rows.reduce((sum, row) => sum + row.value + row.claimableValue, 0)
    return { totalValue, rows }
  }, [staked, infoData, underlyingData, claimableData, denomMap, rewardDenomMap, assets, prices])
}
