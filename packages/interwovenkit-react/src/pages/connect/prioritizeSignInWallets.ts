import { normalizeWalletName } from "./normalizeWalletName"

interface WalletLike {
  id: string
  name: string
}

export const prioritizeSignInWallets = <T extends WalletLike>(
  readyWallets: readonly T[],
  popularWallets: readonly WalletLike[],
  limit: number,
): T[] => {
  if (limit <= 0) return []
  if (readyWallets.length <= limit) return [...readyWallets]

  const popularIds = new Set(popularWallets.map((wallet) => wallet.id))
  const popularNamesNormalized = new Set(
    popularWallets.map((wallet) => normalizeWalletName(wallet.name)),
  )

  const prioritized: T[] = []
  const remaining: T[] = []

  for (const wallet of readyWallets) {
    const isPopular =
      popularIds.has(wallet.id) ||
      popularNamesNormalized.has(normalizeWalletName(wallet.name))

    if (isPopular) {
      prioritized.push(wallet)
    } else {
      remaining.push(wallet)
    }
  }

  return prioritized.concat(remaining).slice(0, limit)
}
