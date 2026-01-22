import type { GeneratedType } from "@cosmjs/proto-signing"
import type { AminoConverters } from "@cosmjs/stargate"
import type { useCreateWallet, useLoginWithSiwe, usePrivy, useWallets } from "@privy-io/react-auth"
import { createContext, useContext } from "react"
import type { Chain } from "@initia/initia-registry-types"

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
  minityUrl: string
  dexUrl: string
  vipUrl: string
  civitiaUrl: string

  theme: "light" | "dark"
  container?: HTMLElement
  disableAnalytics?: boolean
  enableAutoSign?: boolean | Record<string, string[]>
  privyContext?: {
    privy: ReturnType<typeof usePrivy>
    createWallet: ReturnType<typeof useCreateWallet>["createWallet"]
    wallets: ReturnType<typeof useWallets>["wallets"]
    siwe: ReturnType<typeof useLoginWithSiwe>
  }
}

export const ConfigContext = createContext<Config | null>(null)

export function useConfig() {
  const config = useContext(ConfigContext)
  if (!config) throw new Error("Check if the InterwovenKitProvider is mounted")
  return config
}
