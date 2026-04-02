import { normalizeWalletName } from "./normalizeWalletName"

interface WalletLike {
  id: string
  name: string
}

export const prioritizeSignInWallets = <T extends WalletLike>(
  readyWallets: readonly T[],
  popularWallets: readonly WalletLike[],
  limit: number,
  recentWalletId?: string | null,
): T[] => {
  if (limit <= 0) return []
  if (readyWallets.length <= limit) return [...readyWallets]

  const recentWalletIndex = recentWalletId
    ? readyWallets.findIndex((wallet) => wallet.id === recentWalletId)
    : -1
  const recentWallet = recentWalletIndex >= 0 ? readyWallets[recentWalletIndex] : undefined
  const walletsToPrioritize =
    recentWalletIndex >= 0
      ? readyWallets.filter((_, index) => index !== recentWalletIndex)
      : readyWallets

  // Match by exact id when possible. Normalized-name matching is only a
  // fallback for variants like "Leap Wallet", and can still collide.
  const popularIds = new Set(popularWallets.map((wallet) => wallet.id))
  const popularNamesNormalized = new Set(
    popularWallets.map((wallet) => normalizeWalletName(wallet.name)),
  )

  const prioritized: T[] = []
  const remaining: T[] = []

  for (const wallet of walletsToPrioritize) {
    const isPopular =
      popularIds.has(wallet.id) || popularNamesNormalized.has(normalizeWalletName(wallet.name))

    if (isPopular) {
      prioritized.push(wallet)
    } else {
      remaining.push(wallet)
    }
  }

  return recentWallet
    ? [recentWallet, ...prioritized, ...remaining].slice(0, limit)
    : prioritized.concat(remaining).slice(0, limit)
}
