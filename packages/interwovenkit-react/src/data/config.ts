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
  enableAutoSign?: boolean | Record<string, string[]>
  autoSignFeePolicy?: Record<string, AutoSignFeePolicy>
  cosmosWallets?: CosmosWallet[]
}

export const ConfigContext = createContext<Config | null>(null)

export function useConfig() {
  const config = useContext(ConfigContext)
  if (!config) throw new Error("Check if the InterwovenKitProvider is mounted")
  return config
}
