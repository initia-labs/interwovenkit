/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly INITIA_NETWORK_TYPE?: "mainnet" | "testnet"
  readonly INITIA_TEST_MNEMONIC?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
