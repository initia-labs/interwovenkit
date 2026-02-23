import { createQueryKeys } from "@lukemorales/query-key-factory"

export const initiaLiquidityQueryKeys = createQueryKeys("interwovenkit:initia-liquidity", {
  checkLpTokens: (dexUrl: string, denoms: string[]) => [dexUrl, denoms],
  lpPrices: (dexUrl: string, denoms: string[]) => [dexUrl, denoms],
  poolByMetadata: (dexUrl: string, metadata: string) => [dexUrl, metadata],
  clammPositions: (dexUrl: string, address: string) => [dexUrl, address],
  clammPoolInfo: (restUrl: string, chainId: string, metadata: string) => [
    restUrl,
    chainId,
    metadata,
  ],
  clammFees: (restUrl: string, chainId: string, tokenAddress: string) => [
    restUrl,
    chainId,
    tokenAddress,
  ],
  clammIncentive: (
    restUrl: string,
    chainId: string,
    tokenAddress: string,
    incentiveAddress: string,
  ) => [restUrl, chainId, tokenAddress, incentiveAddress],
})
