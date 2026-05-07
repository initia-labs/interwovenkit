import type { Config } from "../../data/config"

export const DEFAULT_GAS_ADJUSTMENT = 1.4
export const DEFAULT_GAS_PRICE_MULTIPLIER = 1.05

export const MAINNET: Config = {
  defaultChainId: "interwoven-1",
  registryUrl: "https://registry.initia.xyz",
  routerApiUrl: "https://router-api.initia.xyz",
  glyphUrl: "https://glyph.initia.xyz",
  usernamesModuleAddress: "0x72ed9b26ecdcd6a21d304df50f19abfdbe31d2c02f60c84627844620a45940ef",
  lockStakeModuleAddress: "0x3a886b32a802582f2e446e74d4a24d1d7ed01adf46d2a8f65c5723887e708789",
  minityUrl: "https://portfolio-api.minity.xyz",
  dexUrl: "https://dex-api.initia.xyz",
  vipUrl: "https://vip-api.initia.xyz",
  theme: "dark",
}

export const TESTNET: Config = {
  defaultChainId: "initiation-2",
  registryUrl: "https://registry.testnet.initia.xyz",
  routerApiUrl: "https://router-api.initiation-2.initia.xyz",
  glyphUrl: "https://glyph.initiation-2.initia.xyz",
  usernamesModuleAddress: "0x42cd8467b1c86e59bf319e5664a09b6b5840bb3fac64f5ce690b5041c530565a",
  lockStakeModuleAddress: "0x81c3ea419d2fd3a27971021d9dd3cc708def05e5d6a09d39b2f1f9ba18312264",
  minityUrl: "https://portfolio-api.minity.xyz",
  dexUrl: "https://dex-api.initiation-2.initia.xyz",
  vipUrl: "https://vip-api.testnet.initia.xyz",
  theme: "dark",
  disableAnalytics: true,
}
