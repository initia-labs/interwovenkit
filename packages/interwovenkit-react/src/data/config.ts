import type { GeneratedType } from "@cosmjs/proto-signing"
import type { AminoConverters } from "@cosmjs/stargate"
import { createContext, useContext } from "react"
import type { Chain } from "@initia/initia-registry-types"

export interface Config {
  defaultChainId: string
  customChain?: Chain
  protoTypes?: Iterable<[string, GeneratedType]>
  aminoConverters?: AminoConverters

  registryUrl: string
  routerApiUrl: string
  usernamesModuleAddress: string

  theme: "light" | "dark"
  container?: HTMLElement
  disableAnalytics?: boolean
}

export const ConfigContext = createContext<Config | null>(null)

export function useConfig() {
  const config = useContext(ConfigContext)
  if (!config) throw new Error("Check if the InterwovenKitProvider is mounted")
  return config
}
