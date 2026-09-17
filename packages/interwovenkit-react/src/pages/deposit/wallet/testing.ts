import type { DepositSession, StorageLike } from "./depositSession"

// Fixtures shared by the deposit session and progress tests, so one record shape describes
// a transfer everywhere and a case's overrides carry only what that case is about.

export const SENDER = "0x4e3d1f2a6b5c8d9e0f1a2b3c4d5e6f7a8b9c0d1e"
export const DEPOSIT_ADDRESS = "0x1111111111111111111111111111111111111111"
export const API_URL = "https://deposit.staging.example"
export const SOURCE_HASH = `0x${"a".repeat(64)}`
export const REPLACEMENT_HASH = `0x${"b".repeat(64)}`

/** A prepared Base → Initia transfer: nothing prompted, nothing broadcast. */
export function buildDepositSession(overrides: Partial<DepositSession> = {}): DepositSession {
  return {
    version: 1,
    id: "session-1",
    apiUrl: API_URL,
    createdAt: 1_000,
    updatedAt: 1_000,
    transport: "lifi",
    phase: "prepared",
    source: {
      chainId: "8453",
      denom: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      decimals: 6,
      sender: SENDER,
      amount: "1500000",
      symbol: "USDC",
      chainName: "Base",
    },
    destination: {
      chainId: "interwoven-1",
      denom: "uusdc",
      recipient: "init1recipient",
      symbol: "USDC",
      chainName: "Initia",
    },
    depositAddress: DEPOSIT_ADDRESS,
    cursor: "cursor-1",
    transaction: {
      chainId: "8453",
      to: "0x2222222222222222222222222222222222222222",
      data: "0xdeadbeef",
      value: "0",
    },
    ...overrides,
  }
}

export interface MemoryStorage extends StorageLike {
  map: Map<string, string>
}

/** Durable by construction: a case that needs a failing store overrides `setItem`. */
export function createMemoryStorage(): MemoryStorage {
  const map = new Map<string, string>()
  return {
    map,
    get length() {
      return map.size
    },
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
  }
}
