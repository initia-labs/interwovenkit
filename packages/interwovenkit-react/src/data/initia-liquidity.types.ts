import type { PoolType } from "./minity"

export interface Coin {
  denom: string
  amount: string
}

export interface CoinWithMetadata extends Coin {
  metadata: string
}

export interface CheckLpTokensResponse {
  data: Record<string, boolean>
}

export interface LpPricesResponse {
  prices: Record<string, number> | Array<{ denom: string; price: number }>
}

export interface PoolResponse {
  lp: string
  lp_metadata: string
  pool_type: PoolType
  symbol?: string
  coins: Array<{ denom: string; weight?: string }>
}

export interface ClammIncentiveResponse {
  incentive_address: string
  lp_metadata: string
  reward_metadata: string
  start_timestamp: string
  end_timestamp: string
  reward_amount: string
}

export interface ClammPositionResponseItem {
  token_address: string
  lp_metadata: string
  tick_lower: string
  tick_upper: string
  liquidity: string
  incentives: ClammIncentiveResponse[]
}

export interface ClammPositionsResponse {
  positions: ClammPositionResponseItem[] | ClammPositionResponseItem[][]
  pagination: {
    next_key: string | null
    total: string
  }
}

export interface ClammPosition {
  tokenAddress: string
  lpMetadata: string
  tickLower: string
  tickUpper: string
  liquidity: string
  incentives: Array<{
    incentiveAddress: string
    rewardMetadata: string
  }>
}

export interface ClammPoolInfo {
  sqrtPrice: string
  tickSpacing: string
}

export interface ClammIncentiveQuery {
  tokenAddress: string
  incentiveAddress: string
}
