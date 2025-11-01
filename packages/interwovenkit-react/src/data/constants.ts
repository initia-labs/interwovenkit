const NAMESPACE = "interwovenkit"

// Time constants in milliseconds
export const SECOND_IN_MS = 1000
export const MINUTE_IN_MS = 60 * SECOND_IN_MS
export const HOUR_IN_MS = 60 * MINUTE_IN_MS
export const DAY_IN_MS = 24 * HOUR_IN_MS
export const YEAR_IN_MS = 365 * DAY_IN_MS

export const LocalStorageKey = {
  // wallet
  PUBLIC_KEY: `${NAMESPACE}:public-key`,

  // bridge
  BRIDGE_SRC_CHAIN_ID: `${NAMESPACE}:bridge:src-chain-id`,
  BRIDGE_SRC_DENOM: `${NAMESPACE}:bridge:src-denom`,
  BRIDGE_DST_CHAIN_ID: `${NAMESPACE}:bridge:dst-chain-id`,
  BRIDGE_DST_DENOM: `${NAMESPACE}:bridge:dst-denom`,
  BRIDGE_QUANTITY: `${NAMESPACE}:bridge:quantity`,
  BRIDGE_SLIPPAGE_PERCENT: `${NAMESPACE}:bridge:slippage-percent`,
  BRIDGE_ROUTE_TYPE: `${NAMESPACE}:bridge:route-type`,
  BRIDGE_HISTORY: `${NAMESPACE}:bridge:history`,

  // op
  OP_REMINDER: `${NAMESPACE}:op:reminder`,

  // auth
  API_AUTH_SESSION: `${NAMESPACE}:api-auth-session`,
}
