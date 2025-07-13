import { AddressUtils } from "@/public/utils"
import { LocalStorageKey } from "./constants"

export function migrateLocalStorage() {
  const deleteKey = "initia-wallet-widget:last-connected-wallet"

  const renameMap = {
    "initia-wallet-widget:chain-ids": LocalStorageKey.ADDED_CHAIN_IDS,
    "initia-wallet-widget:opened-layers-assets": `${LocalStorageKey.OPENED_CHAIN_IDS}:assets`,
    "initia-wallet-widget:opened-layers-nft": `${LocalStorageKey.OPENED_CHAIN_IDS}:nfts`,
  }

  const parseMap = {
    "initia-wallet-widget:fee-denoms": {
      prefix: LocalStorageKey.FEE_DENOM,
      getSuffix: (chainId: string) => chainId,
    },
    "initia-wallet-widget:ethereum-public-keys": {
      prefix: LocalStorageKey.PUBLIC_KEY,
      getSuffix: AddressUtils.toBech32,
    },
  }

  // Delete keys
  localStorage.removeItem(deleteKey)

  // Rename keys
  for (const [oldKey, newKey] of Object.entries(renameMap)) {
    const raw = localStorage.getItem(oldKey)
    if (!raw) continue
    localStorage.setItem(newKey, raw)
    localStorage.removeItem(oldKey)
  }

  // Parse keys
  for (const [oldKey, { prefix, getSuffix }] of Object.entries(parseMap)) {
    const raw = localStorage.getItem(oldKey)
    if (!raw) continue
    try {
      const data = JSON.parse(raw) as Record<string, string>
      for (const [suffix, value] of Object.entries(data)) {
        const fullKey = `${prefix}:${getSuffix(suffix)}`
        localStorage.setItem(fullKey, value)
      }
      localStorage.removeItem(oldKey)
    } catch {
      // ignore
    }
  }
}
