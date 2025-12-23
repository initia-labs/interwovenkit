import type { Config } from "../../data/config"

export const DEFAULT_GAS_ADJUSTMENT = 1.4
export const DEFAULT_GAS_PRICE_MULTIPLIER = 1.05

export const MAINNET: Config = {
  defaultChainId: "interwoven-1",
  registryUrl: "https://registry.initia.xyz",
  routerApiUrl: "https://router-api.initia.xyz",
  glyphUrl: "https://glyph.initia.xyz",
  usernamesModuleAddress: "0x72ed9b26ecdcd6a21d304df50f19abfdbe31d2c02f60c84627844620a45940ef",
  theme: "dark",
}

export const TESTNET: Config = {
  defaultChainId: "initiation-2",
  registryUrl: "https://registry.testnet.initia.xyz",
  routerApiUrl: "https://router-api.initiation-2.initia.xyz",
  glyphUrl: "https://glyph.initiation-2.initia.xyz",
  usernamesModuleAddress: "0x42cd8467b1c86e59bf319e5664a09b6b5840bb3fac64f5ce690b5041c530565a",
  theme: "dark",
  disableAnalytics: true,
}
