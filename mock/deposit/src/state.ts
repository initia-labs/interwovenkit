// In-memory stores for the simulation: deposits, checkouts, deposit-address
// mappings, and the runtime config. Runtime-neutral (no Node-specific APIs) so a
// remote deployment can swap this for a storage adapter. Owns no timers or
// upstream calls — those live in lifecycle.ts, checkout.ts, and proxy.ts.

import type { Deposit } from "../../../packages/interwovenkit-react/src/pages/deposit/data/types.ts"
import type { DepositMockConfig } from "./config.ts"
import { defaultConfig } from "./config.ts"

/** A simulated deposit: the wire record plus ms-precision ordering fields. */
export interface SimDeposit {
  record: Deposit
  /** Full-precision creation instant; the wire `created_at` is truncated to seconds. */
  createdAtMs: number
  observedAtMs: number
}

export interface CheckoutRecord {
  transactionId: string
  /** Client idempotency key: the same uuid always returns the same checkout. */
  uuid: string
  walletAddress: string
  chainId: string
  assetDenom: string
  depositAddress: string
  onramp: string
  fiat: string
  crypto: string
  network: string
  amount: number
  paymentMethod: string
  createdAtMs: number
  paid: boolean
}

/** One issued deposit address, observed from the upstream API. */
export interface AddressMapping {
  /** EIP-55 checksummed, exactly as the upstream returned it. */
  depositAddress: string
  /** Normalized lowercase init bech32. */
  walletAddress: string
  chainId: string
  assetDenom: string
}

let config: DepositMockConfig = defaultConfig()
const deposits = new Map<string, SimDeposit>()
const checkouts = new Map<string, CheckoutRecord>()
const checkoutsByUuid = new Map<string, CheckoutRecord>()
const mappingsByTriple = new Map<string, AddressMapping>()
const mappingsByAddress = new Map<string, AddressMapping>()

// Arbitrary but monotonic, so records look like real indexer observations.
let observedHeight = 23_000_000

export function getConfig(): DepositMockConfig {
  return config
}

export function patchConfig(patch: Partial<DepositMockConfig>): DepositMockConfig {
  config = { ...config, ...patch }
  return config
}

export function nextObservedHeight(): number {
  observedHeight += 1
  return observedHeight
}

export function addDeposit(sim: SimDeposit): void {
  deposits.set(sim.record.id, sim)
}

export function getDeposit(id: string): SimDeposit | undefined {
  return deposits.get(id)
}

export function listDeposits(): SimDeposit[] {
  return [...deposits.values()]
}

export function findDepositBySourceTx(srcChainId: string, txHash: string): SimDeposit | undefined {
  return listDeposits().find(
    (sim) => sim.record.src_chain_id === srcChainId && sim.record.src_tx_hash === txHash,
  )
}

const tripleKey = (walletAddress: string, chainId: string, assetDenom: string): string =>
  `${walletAddress}|${chainId}|${assetDenom.toLowerCase()}`

export function recordAddressMapping(mapping: AddressMapping): void {
  mappingsByTriple.set(
    tripleKey(mapping.walletAddress, mapping.chainId, mapping.assetDenom),
    mapping,
  )
  mappingsByAddress.set(mapping.depositAddress.toLowerCase(), mapping)
}

export function findMappingByTriple(
  walletAddress: string,
  chainId: string,
  assetDenom: string,
): AddressMapping | undefined {
  return mappingsByTriple.get(tripleKey(walletAddress, chainId, assetDenom))
}

export function findMappingByAddress(depositAddress: string): AddressMapping | undefined {
  return mappingsByAddress.get(depositAddress.toLowerCase())
}

export function addCheckout(record: CheckoutRecord): void {
  checkouts.set(record.transactionId, record)
  checkoutsByUuid.set(record.uuid, record)
}

export function getCheckout(transactionId: string): CheckoutRecord | undefined {
  return checkouts.get(transactionId)
}

export function findCheckoutByUuid(uuid: string): CheckoutRecord | undefined {
  return checkoutsByUuid.get(uuid)
}

export function listCheckouts(): CheckoutRecord[] {
  return [...checkouts.values()]
}

/** Clears all simulation state and restores the default config. */
export function resetState(): void {
  config = defaultConfig()
  deposits.clear()
  checkouts.clear()
  checkoutsByUuid.clear()
  mappingsByTriple.clear()
  mappingsByAddress.clear()
}
