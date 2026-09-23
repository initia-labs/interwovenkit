import type { KyInstance } from "ky"
import { HTTPError } from "ky"
import { useState } from "react"
import { queryOptions, useQuery } from "@tanstack/react-query"
import { useConfig } from "@/data/config"
import { normalizeError } from "@/data/http"
import { depositQueryKeys, useDepositApi } from "./api"
import { normalizeDenom } from "./assetOptions"
import { assertField, eqAddress, isRecord, isString } from "./parse"
import { ETHEREUM_CHAIN_ID, ETHEREUM_USDC_DENOM } from "./source"
import type { Deposit, DepositBucket, ListDepositsResponse } from "./types"
import { ACTIVE_DEPOSIT_BUCKETS, DEPOSIT_BUCKETS } from "./types"

// Deliberately the negation of the active set: an unknown bucket must count
// as terminal so polling stops, matching the server's own fail-closed mapping
// of unknown statuses onto `failed`. Takes the raw wire string
// (`Deposit.bucket` is deliberately `string`, see types.ts).
export const isTerminalBucket = (bucket: string): boolean =>
  !(ACTIVE_DEPOSIT_BUCKETS as readonly string[]).includes(bucket)

const isDepositBucket = (value: string): value is DepositBucket =>
  (DEPOSIT_BUCKETS as readonly string[]).includes(value)

/**
 * The bucket to render. The single parse point from the wire string to the
 * `DepositBucket` union: an unknown value renders as the failed screen
 * (fail-closed, consistent with isTerminalBucket). Null is the transient
 * re-discovery frame, rendered as waiting.
 */
export function displayBucket(deposit: Deposit | null): DepositBucket {
  if (!deposit) return "waiting"
  return isDepositBucket(deposit.bucket) ? deposit.bucket : "failed"
}

// Recommended client polling is 3s (server scan loop is 5s). Deposit screens
// can stay open for hours (a QR left open, an onramp KYC), so after
// IDLE_BACKOFF_DELAY of screen age the interval relaxes: detection still
// lands within 15s — fine against a bridge that takes minutes — while the
// first minutes, when the user is actively watching, keep the snappy cadence.
const POLL_INTERVAL = 3000
const IDLE_POLL_INTERVAL = 15_000
const IDLE_BACKOFF_DELAY = 5 * 60_000

/** Poll interval by screen age: POLL_INTERVAL while fresh, IDLE_POLL_INTERVAL once idle. */
export const pollInterval = (elapsedMs: number) =>
  elapsedMs < IDLE_BACKOFF_DELAY ? POLL_INTERVAL : IDLE_POLL_INTERVAL

/**
 * The consuming screen's mount time; screen age approximates user attention.
 * Query-cache timestamps would survive re-entries and start a freshly opened
 * screen already backed off.
 */
function useMountedAt() {
  const [mountedAt] = useState(() => Date.now())
  return mountedAt
}

/** Stop polling once the deposit is terminal. A null/undefined deposit keeps
 * polling — not-yet-fetched is not a terminal answer. */
export const pollUntilTerminal = (deposit: Deposit | null | undefined, elapsedMs: number) =>
  deposit && isTerminalBucket(deposit.bucket) ? false : pollInterval(elapsedMs)

/**
 * GET /v1/deposits/{id}. Authoritative single-deposit lifecycle polling.
 * The id came from the backend itself, so a 404 is a contract violation and
 * throws instead of silently polling a null forever.
 */
export function useDeposit(id: string) {
  const { depositApiUrl } = useConfig()
  const api = useDepositApi()
  const mountedAt = useMountedAt()
  return useQuery({
    queryKey: depositQueryKeys.deposit(id).queryKey,
    queryFn: async (): Promise<Deposit> => {
      try {
        return await api.get(`v1/deposits/${id}`).json<Deposit>()
      } catch (error) {
        throw await normalizeError(error)
      }
    },
    enabled: !!depositApiUrl && !!id,
    refetchInterval: (query) => pollUntilTerminal(query.state.data, Date.now() - mountedAt),
  })
}

/**
 * The server's `deposit_address` filter returned a foreign deposit. Typed so
 * consumers route it to a hard-error screen instead of a "retrying" notice —
 * every poll reproduces it, unlike transient errors.
 */
export class DepositAddressMismatchError extends Error {}

/**
 * Boundary guard for the server's `deposit_address` filter: tracking trusts
 * the filtered list wholesale, so a foreign deposit (a server filter bug, or
 * an older server ignoring the parameter) would be silently tracked with
 * someone else's amounts and statuses. Each deposit carries its own
 * `deposit_address`, so the check is free; the server matches the address
 * case-insensitively, so compare likewise.
 */
export function assertDepositsAtAddress(deposits: Deposit[], depositAddress: string): Deposit[] {
  const address = depositAddress.toLowerCase()
  const foreign = deposits.find((deposit) => deposit.deposit_address.toLowerCase() !== address)
  if (foreign) {
    throw new DepositAddressMismatchError(
      `Deposit ${foreign.id} belongs to ${foreign.deposit_address}, not the requested ${depositAddress}`,
    )
  }
  return deposits
}

interface NewDepositsParams {
  /** Deterministic deposit address from useFreshDepositAddress's query. */
  depositAddress: string
  /**
   * Mount-fresh cursor from useFreshDepositAddress; empty until the mount's
   * fetch succeeds, keeping this query disabled so detection never runs
   * against a previous mount's watermark.
   */
  after: string
}

/**
 * GET /v1/deposits after this mount's cursor watermark — the advance screens'
 * detection poll. Membership is by creation time, so a deposit that went
 * terminal between polls still counts, while an older deposit still bridging
 * at this reused address must not advance the screen (it surfaces through
 * useActiveDeposits as a resume link instead). Existence is the only
 * question, so `limit=1`.
 */
export function useNewDeposits({ depositAddress, after }: NewDepositsParams) {
  const { depositApiUrl } = useConfig()
  const api = useDepositApi()
  const mountedAt = useMountedAt()
  return useQuery({
    queryKey: depositQueryKeys.newDeposits(depositAddress, after).queryKey,
    queryFn: async (): Promise<Deposit[]> => {
      try {
        const { deposits } = await api
          .get("v1/deposits", {
            searchParams: { deposit_address: depositAddress, after, limit: "1" },
          })
          .json<ListDepositsResponse>()
        return assertDepositsAtAddress(deposits, depositAddress)
      } catch (error) {
        if (error instanceof DepositAddressMismatchError) throw error
        throw await normalizeError(error)
      }
    },
    enabled: !!depositApiUrl && !!depositAddress && !!after,
    refetchInterval: () => pollInterval(Date.now() - mountedAt),
  })
}

/**
 * GET /v1/deposits with `active=true`: in-flight deposits regardless of age.
 * Powers the "transfer detected" resume link, keeping a transfer from an
 * earlier session reachable without auto-navigating away from the QR —
 * auto-advance is reserved for new arrivals (useNewDeposits). Existence is
 * the only question, so `limit=1`. Its only change after the first fetch is
 * the link disappearing on settlement — no urgency, so it polls at
 * IDLE_POLL_INTERVAL from the start.
 */
export function useActiveDeposits(depositAddress: string) {
  const { depositApiUrl } = useConfig()
  const api = useDepositApi()
  return useQuery({
    queryKey: depositQueryKeys.activeDeposits(depositAddress).queryKey,
    queryFn: async (): Promise<Deposit[]> => {
      try {
        const { deposits } = await api
          .get("v1/deposits", {
            searchParams: { deposit_address: depositAddress, active: "true", limit: "1" },
          })
          .json<ListDepositsResponse>()
        return assertDepositsAtAddress(deposits, depositAddress)
      } catch (error) {
        if (error instanceof DepositAddressMismatchError) throw error
        throw await normalizeError(error)
      }
    },
    enabled: !!depositApiUrl && !!depositAddress,
    refetchInterval: IDLE_POLL_INTERVAL,
  })
}

interface TrackedDepositParams {
  /** Deterministic deposit address used to verify the fetched record. */
  depositAddress: string
  /** Exact id returned by useNewDeposits or useActiveDeposits. */
  depositId: string
}

export interface TrackedDeposit {
  /** The discovered deposit, or null while still waiting for detection. */
  deposit: Deposit | null
  isError: boolean
  error: Error | null
}

/** Resolves one id-addressed detail response into the tracking view model. */
export function resolveTrackedDeposit(
  deposit: Deposit | undefined,
  depositAddress: string,
  detailError: Error | null,
): TrackedDeposit {
  const hasAddressMismatch =
    !!deposit &&
    !!depositAddress &&
    deposit.deposit_address.toLowerCase() !== depositAddress.toLowerCase()
  const mismatchError = hasAddressMismatch
    ? new DepositAddressMismatchError(
        `Deposit ${deposit.id} belongs to ${deposit.deposit_address}, not the requested ${depositAddress}`,
      )
    : null

  return {
    deposit: mismatchError ? null : (deposit ?? null),
    isError: !!detailError || !!mismatchError,
    error: mismatchError ?? detailError,
  }
}

/**
 * Polls the exact record detected by the preceding screen. The address remains
 * a trust-boundary check: an id/address disagreement must fail before another
 * wallet's transfer is rendered.
 */
export function useTrackedDeposit({
  depositAddress,
  depositId,
}: TrackedDepositParams): TrackedDeposit {
  const detail = useDeposit(depositId)
  return resolveTrackedDeposit(detail.data, depositAddress, detail.error ?? null)
}

// Unlike displayBucket, an unknown bucket is not "failed": the user has just signed a real
// transfer.
export type WalletDepositBucket = DepositBucket | "unknown"

export function classifyWalletBucket(deposit: Deposit | null): WalletDepositBucket {
  if (!deposit) return "waiting"
  return isDepositBucket(deposit.bucket) ? deposit.bucket : "unknown"
}

export const bySourceTxPollInterval = (deposit: Deposit | null | undefined, elapsedMs: number) =>
  deposit ? false : pollInterval(elapsedMs)

export function createDepositBySourceTxQueryOptions(
  api: KyInstance,
  srcTxHash: string,
  enabled: boolean,
  startedAt: number,
) {
  return queryOptions({
    queryKey: depositQueryKeys.depositBySourceTx(ETHEREUM_CHAIN_ID, srcTxHash).queryKey,
    queryFn: async (): Promise<Deposit | null> => {
      try {
        return await api
          .get(`v1/deposits/by-source-tx/${srcTxHash}`, {
            searchParams: { src_chain_id: ETHEREUM_CHAIN_ID },
            retry: 0,
          })
          .json<Deposit>()
      } catch (error) {
        if (error instanceof HTTPError && error.response.status === 404) return null
        throw await normalizeError(error)
      }
    },
    enabled,
    staleTime: 0,
    refetchInterval: (query) => bySourceTxPollInterval(query.state.data, Date.now() - startedAt),
  })
}

interface DepositIdentity {
  depositAddress: string
  dstChainId: string
  dstDenom: string
  /** Final credited wallet, init bech32 lowercase. */
  recipient: string
}

export function asDepositRecord(value: unknown, context: string): Deposit {
  assertField(isRecord(value), `${context} is not an object`)
  for (const field of [
    "id",
    "src_chain_id",
    "src_tx_hash",
    "src_denom",
    "amount",
    "deposit_address",
    "wallet_address",
    "dst_chain_id",
    "dst_denom",
    "bucket",
  ]) {
    assertField(
      isString(value[field]),
      `${context} has an invalid ${field}: ${String(value[field])}`,
    )
  }
  return value as unknown as Deposit
}

// A mismatch here would track, and eventually complete, somebody else's deposit at the same reused
// address.
export function assertDirectDeposit(
  record: unknown,
  identity: DepositIdentity & { srcTxHash: string; amount: string },
): Deposit {
  const deposit = asDepositRecord(record, "Deposit record")
  assertField(
    deposit.src_tx_hash.toLowerCase() === identity.srcTxHash.toLowerCase(),
    `Deposit record src_tx_hash ${deposit.src_tx_hash} is not the submitted ${identity.srcTxHash}`,
  )
  assertField(
    deposit.amount === identity.amount,
    `Deposit record amount ${deposit.amount} is not the transferred ${identity.amount}`,
  )
  assertDepositIdentity(deposit, identity)
  return deposit
}

// The record describes the Ethereum leg after slippage, so it binds to the receiving hash when
// known, never the amount.
export function assertLifiDeposit(
  deposit: Deposit,
  identity: DepositIdentity & { dstTxHash?: string },
): Deposit {
  if (identity.dstTxHash) {
    assertField(
      deposit.src_tx_hash.toLowerCase() === identity.dstTxHash.toLowerCase(),
      `Deposit record src_tx_hash ${deposit.src_tx_hash} is not the reported Ethereum delivery ${identity.dstTxHash}`,
    )
  }
  assertDepositIdentity(deposit, identity)
  return deposit
}

function assertDepositIdentity(deposit: Deposit, identity: DepositIdentity): void {
  assertField(
    deposit.src_chain_id === ETHEREUM_CHAIN_ID,
    `Deposit record src_chain_id is ${deposit.src_chain_id}, not Ethereum`,
  )
  assertField(
    normalizeDenom(deposit.src_denom) === normalizeDenom(ETHEREUM_USDC_DENOM),
    `Deposit record src_denom ${deposit.src_denom} is not Ethereum USDC`,
  )
  assertField(
    eqAddress(deposit.deposit_address, identity.depositAddress),
    `Deposit record deposit_address ${deposit.deposit_address} is not the issued ${identity.depositAddress}`,
  )
  assertField(
    deposit.dst_chain_id === identity.dstChainId,
    `Deposit record dst_chain_id ${deposit.dst_chain_id} is not ${identity.dstChainId}`,
  )
  assertField(
    normalizeDenom(deposit.dst_denom) === normalizeDenom(identity.dstDenom),
    `Deposit record dst_denom ${deposit.dst_denom} is not ${identity.dstDenom}`,
  )
  assertField(
    eqAddress(deposit.wallet_address, identity.recipient),
    `Deposit record wallet_address ${deposit.wallet_address} is not the recipient ${identity.recipient}`,
  )
}
