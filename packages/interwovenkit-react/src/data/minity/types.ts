// ============================================
// BALANCE TYPES (Discriminated Union)
// ============================================

/** Token Asset Balance */
export interface TokenAsset {
  type: "asset"
  denom: string
  symbol: string
  value?: number
  amount: string
  formattedAmount: number
  decimals: number
}

/** LP Token Balance with underlying coins */
export interface LpAsset {
  type: "lp"
  denom: string
  symbol: string
  value?: number
  amount: string
  formattedAmount: number
  decimals: number
  coins: Array<{
    denom: string
    symbol: string
    amount: string
    formattedAmount: number
    decimals: number
  }>
}

/** Unknown Asset (no metadata) */
export interface UnknownAsset {
  type: "unknown"
  denom: string
  amount: string
}

/** Balance Discriminated Union */
export type Balance = TokenAsset | LpAsset | UnknownAsset

// ============================================
// POSITION TYPES (Discriminated Union)
// ============================================

/** Staking Position (validator required for Initia, optional for general staking) */
export interface StakingPosition {
  type: "staking"
  validator?: string
  balance: Balance
}

/** Initia Unstaking Position (unbonding) */
export interface UnstakingPosition {
  type: "unstaking"
  validator: string
  completionTime?: number
  balance: Balance
}

/** Initia Lock-Staking Position */
export interface LockStakingPosition {
  type: "lockstaking"
  validator: string
  releaseTime?: number
  balance: Balance
}

/** General Lending Position (Echelon, Inertia) */
export interface LendingPosition {
  type: "lending"
  direction: "borrow" | "supply"
  balance: Balance
}

/** Fungible Position (NFT-like tokens) */
export interface FungiblePosition {
  type: "fungible-position"
  status?: "staked" | "owned"
  title: string
  value?: number
  amount: number
  imageUrl?: string
}

/** Position Discriminated Union */
export type Position =
  | StakingPosition
  | UnstakingPosition
  | LockStakingPosition
  | LendingPosition
  | FungiblePosition

// ============================================
// PROTOCOL POSITION TYPE
// ============================================

export interface ProtocolPosition {
  protocol: string
  manageUrl?: string
  positions: Position[]
}

// ============================================
// POSITION GROUPING TYPES
// ============================================

/** Section group with positions and pre-calculated total value */
export interface SectionGroup {
  positions: Position[]
  totalValue: number // Actual value (negative for borrowing)
}

/** Denom group with aggregated values */
export interface DenomGroup {
  denom: string
  symbol: string
  positions: Position[]
  totalValue: number
  totalAmount: number
  balance: Balance | null
}

// ============================================
// LIQUIDITY TYPES
// ============================================

/** Liquidity position breakdown by state */
export interface LiquidityPositionBreakdown {
  deposit: number // LP tokens in wallet
  staking: number // LP tokens staked
  lockStaking: number // LP tokens in lock staking
  unstaking: number // LP tokens unbonding
}

/** Pool types */
export type PoolType = "BALANCER" | "CLAMM" | "STABLE_SWAP" | "UOINIT"

export interface ClammLiquidityPosition {
  tokenAddress: string
  positionId: string
  inRange?: boolean
  isFullRange?: boolean
  minPrice?: number
  maxPrice?: number
  pricePairLabel: string
  rewardValue: number
  value: number
}

export interface ClammLiquidityRowData {
  lpMetadata: string
  totalRewardValue: number
  positions: ClammLiquidityPosition[]
}

/** Claimable INIT rewards breakdown */
export interface ClaimableInitBreakdown {
  staking: string // Claimable from regular staking
  lockStaking: string // Claimable from lock staking
  total: string // Total claimable INIT
  totalValue: number // Total value in USD
}

/** Liquidity table row (one per LP token) */
export interface LiquidityTableRow {
  denom: string
  symbol: string
  totalAmount: number
  totalValue: number
  decimals: number
  poolType?: PoolType
  logoUrl?: string // LP token's own logo (for tokens without coinLogos like omniINIT)
  coinLogos?: string[] // [logoUrl1, logoUrl2] for paired tokens
  breakdown: LiquidityPositionBreakdown
  claimableInit?: ClaimableInitBreakdown
  isClamm?: boolean
  clamm?: ClammLiquidityRowData
}

/** Liquidity section data */
export interface LiquiditySectionData {
  totalValue: number
  rows: LiquidityTableRow[]
}

// ============================================
// MISCELLANEOUS TYPES
// ============================================

/** Supported Chains Response */
export type SupportedChains = string[]

/** Prices Response (array of [symbol, price] tuples) */
export type PriceEntry = [string, number]
export type Prices = PriceEntry[]

// ============================================
// PORTFOLIO SUMMARY TYPES
// ============================================

export interface ChainBreakdownItem {
  chainId: string
  chainName: string
  logoUrl: string
  totalBalance: number
  percentage: number
}

/** Chain info for display (logo, name) - independent from balances/positions */
export interface ChainInfo {
  chainId: string
  chainName: string
  prettyName: string
  logoUrl: string
}

export interface ChainBalanceData {
  chainName: string
  chainId: string
  balances: Balance[]
}

export interface ChainPositionData {
  chainId: string
  chainName: string
  positions: ProtocolPosition[]
}

// ============================================
// SSE TYPES
// ============================================

/** SSE event data for balances */
export interface SSEBalanceEvent {
  type: "balances"
  chain: string
  chainId: string
  balances: Balance[]
}

/** SSE event data for positions */
export interface SSEPositionEvent {
  type: "positions"
  chain: string
  chainId: string
  positions: ProtocolPosition[]
}

/** SSE event union type */
export type SSEEvent = SSEBalanceEvent | SSEPositionEvent

/** Portfolio data from SSE stream */
export interface SSEPortfolioData {
  balances: ChainBalanceData[]
  positions: ChainPositionData[]
  isLoading: boolean
  isComplete: boolean
}

// ============================================
// PORTFOLIO POSITION GROUPING TYPES
// ============================================

/** Position group by chain */
export interface PortfolioChainPositionGroup {
  chainId: string
  chainName: string
  chainLogo: string
  protocols: ProtocolPosition[]
  isInitia?: boolean
  totalValue: number
}
