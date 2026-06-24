import BigNumber from "bignumber.js"
import { useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { bcs, createMoveClient, fromBaseUnit } from "@initia/utils"
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

  const objectArg = (value: string) => bcs.object().serialize(value).toBase64()
  const addressArg = (value: string) => bcs.address().serialize(value).toBase64()

  const { data: staked } = useSuspenseQuery({
    queryKey: initiaVaultQueryKeys.staked(restUrl, moduleAddress, address).queryKey,
    queryFn: async (): Promise<StakedToken[]> => {
      if (!address || !moduleAddress) return []
      try {
        return await viewFunction<StakedToken[]>({
          moduleAddress,
          moduleName: VAULT_STAKING_MODULE,
          functionName: "user_staked_tokens",
          typeArgs: [],
          args: [addressArg(address)],
        })
      } catch {
        return []
      }
    },
    staleTime: STALE_TIMES.MINUTE,
  })

  const infos = useSuspenseQueries({
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
  })

  const underlyings = useSuspenseQueries({
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
  })

  const claimables = useSuspenseQueries({
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
  })

  // react-query data is referentially stable; copy out the parts we need so nothing downstream
  // depends on the (unstable) useSuspenseQueries result objects.
  const infoData = infos.map((query) => query.data)
  const underlyingData = underlyings.map((query) => query.data)
  const claimableData = claimables.map((query) => query.data ?? [])

  // Resolve fungible-asset metadata addresses to denoms so the pair (and rewards) can be named/priced.
  const assetMetadatas = [
    ...new Set(infoData.flatMap((info) => (info ? [info.asset_0, info.asset_1] : []))),
  ]
  const rewardMetadatas = [
    ...new Set(claimableData.flatMap((rewards) => rewards.map((reward) => reward.metadata))),
  ]
  const denomMap = useDenoms(assetMetadatas, { failSoft: true })
  const rewardDenomMap = useDenoms(rewardMetadatas, { failSoft: true })

  const assetByDenom = new Map(assets.map((asset) => [asset.denom, asset]))
  const priceOf = (denom: string) => prices?.find((p) => p.id === denom)?.price ?? 0

  const rows = staked
    .map((token, index): VaultPositionRow | null => {
      const info = infoData[index]
      const underlying = underlyingData[index]
      if (!info || !underlying) return null

      // Oracle prices are pre-scaled, so price * rawAmount yields a USD value directly.
      const value = BigNumber(info.oracle_price_0)
        .times(underlying[0])
        .plus(BigNumber(info.oracle_price_1).times(underlying[1]))
        .toNumber()

      const asset0 = assetByDenom.get(denomMap.get(info.asset_0) ?? "")
      const asset1 = assetByDenom.get(denomMap.get(info.asset_1) ?? "")

      const claimableValue = claimableData[index].reduce((sum, reward) => {
        const denom = rewardDenomMap.get(reward.metadata) ?? ""
        const asset = assetByDenom.get(denom)
        const amount = fromBaseUnit(reward.amount, { decimals: asset?.decimals ?? 6 })
        return sum + Number(amount) * priceOf(denom)
      }, 0)

      return {
        vaultAddress: token.metadata,
        symbol: [asset0?.symbol, asset1?.symbol].filter(Boolean).join("-"),
        coinLogos: [asset0?.logoUrl ?? "", asset1?.logoUrl ?? ""],
        isActive: info.is_active,
        value,
        claimableValue,
      }
    })
    .filter((row): row is VaultPositionRow => row !== null)

  const totalValue = rows.reduce((sum, row) => sum + row.value + row.claimableValue, 0)
  return { totalValue, rows }
}
