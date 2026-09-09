import type { OfflineAminoSigner } from "@cosmjs/amino"
import type { GeneratedType } from "@cosmjs/proto-signing"
import type { AminoConverters } from "@cosmjs/stargate"
import type { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin"
import { createContext, useContext } from "react"
import type { Chain } from "@initia/initia-registry-types"
import type { AutoSignPermissionPolicy } from "@/pages/autosign/data/policy"

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

export interface AutoSignGrantPolicy {
  /** Enables this chain with the specified scope; overrides its legacy message list. */
  authorization?: AutoSignPermissionPolicy
  /** Cumulative on-chain fee allowance in base units. Omit for an unlimited allowance. */
  feeBudget?: Coin[]
}

export interface Config {
  defaultChainId: string
  customChain?: Chain
  protoTypes?: Iterable<[string, GeneratedType]>
  aminoConverters?: AminoConverters

  registryUrl: string
  routerApiUrl: string
  glyphUrl: string
  usernamesModuleAddress: string
  lockStakeModuleAddress: string
  clammVaultModuleAddress: string
  minityUrl: string
  dexUrl: string
  vipUrl: string
  theme: "light" | "dark"
  container?: HTMLElement
  disableAnalytics?: boolean
  /** Legacy generic permissions. Explicit false disables autosign, including scoped policies. */
  enableAutoSign?: boolean | Record<string, string[]>
  autoSignFeePolicy?: Record<string, AutoSignFeePolicy>
  /** Authorization opts each chain in; feeBudget alone requires enableAutoSign. */
  autoSignGrantPolicy?: Record<string, AutoSignGrantPolicy>
  /** Browser storage supports Stay connected; memory disables all signer persistence. */
  autoSignStorage?: "browser" | "memory"
  cosmosWallets?: CosmosWallet[]
}

export const ConfigContext = createContext<Config | null>(null)

export function useConfig() {
  const config = useContext(ConfigContext)
  if (!config) throw new Error("Check if the InterwovenKitProvider is mounted")
  return config
}
