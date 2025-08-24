/** Normalize the chain information from both Initia registry and Skip API */

export interface BaseChain {
  chainId: string
  name: string
  logoUrl: string
}

export interface BaseAsset {
  denom: string
  symbol: string
  decimals: number
  logoUrl: string
  name?: string
  balance?: string
  value?: number
}
