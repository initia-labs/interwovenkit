const NAMESPACE = "interwovenkit"
const LEGACY_NAMESPACE = "initia-wallet-widget"

export const LocalStorageKey = {
  // ui
  ADDED_CHAIN_IDS: `${NAMESPACE}:chain-ids:added`,
  OPENED_CHAIN_IDS: `${NAMESPACE}:chain-ids:opened`,

  // wallet
  PUBLIC_KEY: `${NAMESPACE}:public-key`,
  WAGMI_RECENT_CONNECTOR_ID: `wagmi.recentConnectorId`,

  // tx fee
  FEE_DENOM: `${NAMESPACE}:fee-denom`,

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
}

// items from old widget that can be mapped 1:1
export const LegacyLocalStorageKey = {
  [`${LEGACY_NAMESPACE}:chain-ids`]: LocalStorageKey.ADDED_CHAIN_IDS,
  [`${LEGACY_NAMESPACE}:opened-layers-assets`]: `${LocalStorageKey.OPENED_CHAIN_IDS}:assets`,
  [`${LEGACY_NAMESPACE}:opened-layers-nft`]: `${LocalStorageKey.OPENED_CHAIN_IDS}:nft`,
}

// items from old widget that need parsing
export const LegacyLocalStorageObject = {
  [`${LEGACY_NAMESPACE}:fee-denoms`]: LocalStorageKey.FEE_DENOM,
  [`${LEGACY_NAMESPACE}:ethereum-public-keys`]: LocalStorageKey.PUBLIC_KEY,
}
