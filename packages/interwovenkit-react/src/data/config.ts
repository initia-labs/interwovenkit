import type { GeneratedType } from "@interchainjs/cosmos-types"
import type { AminoConverter } from "@interchainjs/cosmos-types"
import { createContext, useContext } from "react"
import type { Chain } from "@initia/initia-registry-types"

export interface Config {
  defaultChainId: string
  customChain?: Chain
  protoTypes?: Iterable<[string, GeneratedType]>
  aminoConverters?: AminoConverter[]

  registryUrl: string
  routerApiUrl: string
  usernamesModuleAddress: string

  theme: "light" | "dark"
  container?: HTMLElement
}

export const ConfigContext = createContext<Config>(null!)

export function useConfig() {
  return useContext(ConfigContext)
}
