import type { OfflineAminoSigner } from "@cosmjs/amino"
import type { GeneratedType } from "@cosmjs/proto-signing"
import type { AminoConverters } from "@cosmjs/stargate"
import { createContext, useContext } from "react"
import type { Chain } from "@initia/initia-registry-types"

export interface CosmosWalletProvider {
  getOfflineSigner(chainId: string): OfflineAminoSigner
  getOfflineSignerOnlyAmino(chainId: string): OfflineAminoSigner
}

export interface CosmosWallet {
  name: string
  image?: string
  getProvider: () => CosmosWalletProvider | undefined
  fallbackUrl?: string
}

export interface AutoSignFeePolicy {
  gasMultiplier?: number
  maxGasMultiplierFromSim?: number
  allowedFeeDenoms?: string[]
}

export interface Config {
  /** Chain id the widget targets by default. */
  defaultChainId: string
  /** Chain definition that overrides or extends the registry entry. */
  customChain?: Chain
  /** Extra proto message types merged into the signing registry. */
  protoTypes?: Iterable<[string, GeneratedType]>
  /** Extra amino converters merged into the signing registry. */
  aminoConverters?: AminoConverters

  /** Initia chain registry base URL. */
  registryUrl: string
  /** Router API (Skip) base URL for bridging and swaps. */
  routerApiUrl: string
  /** Glyph base URL for NFT image rendering. */
  glyphUrl: string
  /** Move module address for usernames. */
  usernamesModuleAddress: string
  /** Move module address for lock staking. */
  lockStakeModuleAddress: string
  /** Move module address for CLAMM vaults. */
  clammVaultModuleAddress: string
  /** Minity portfolio API base URL (SSE streaming). */
  minityUrl: string
  /** DEX indexer API base URL for LP prices and positions. */
  dexUrl: string
  /** VIP API base URL for vesting positions. */
  vipUrl: string
  /** Deposit API base URL; unset disables the deposit methods that rely on it. */
  depositApiUrl?: string
  /** Onramper API base URL; unset disables the cash method. */
  onramperApiUrl?: string
  /** Onramper publishable key (`pk_...`); override to bill your own account. */
  onramperApiKey?: string
  /** Color theme. */
  theme: "light" | "dark"
  /** Element the widget portals into instead of the default shadow root. */
  container?: HTMLElement
  /** Disables usage analytics. */
  disableAnalytics?: boolean
  /** Auto-sign opt-in: `true`, or a chain id → allowed message type URLs map. */
  enableAutoSign?: boolean | Record<string, string[]>
  /** Per-chain fee policy for auto-signed transactions. */
  autoSignFeePolicy?: Record<string, AutoSignFeePolicy>
  /** Cosmos wallets offered in the connect list. */
  cosmosWallets?: CosmosWallet[]
}

export const ConfigContext = createContext<Config | null>(null)

export function useConfig() {
  const config = useContext(ConfigContext)
  if (!config) throw new Error("Check if the InterwovenKitProvider is mounted")
  return config
}
