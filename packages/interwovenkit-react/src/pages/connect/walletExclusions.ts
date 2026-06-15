import { normalizeWalletName } from "./normalizeWalletName"
import type { WalletLike } from "./prioritizeSignInWallets"

const EXCLUDED_WALLET_IDS = new Set(["io.leapwallet"])
const EXCLUDED_WALLET_NAMES = new Set(["leap"])

export const isExcludedWallet = (wallet: WalletLike) =>
  EXCLUDED_WALLET_IDS.has(wallet.id) || EXCLUDED_WALLET_NAMES.has(normalizeWalletName(wallet.name))
