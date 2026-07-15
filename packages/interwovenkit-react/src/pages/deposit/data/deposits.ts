import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useConfig } from "@/data/config"
import { normalizeError } from "@/data/http"
import { depositQueryKeys, useDepositApi } from "./api"
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
 * Stop list-polling once the list is non-empty and all terminal; an empty or
 * not-yet-fetched list keeps polling. Stopping cannot miss the deposit in
 * question: tracking renders only after detection (useNewDeposits) or the
 * resume link (useActiveDeposits) has confirmed it, so the first list fetch
 * includes it.
 */
export const pollUntilAllTerminal = (deposits: Deposit[] | undefined, elapsedMs: number) =>
  deposits && deposits.length > 0 && deposits.every((deposit) => isTerminalBucket(deposit.bucket))
    ? false
    : pollInterval(elapsedMs)

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

/**
 * GET /v1/deposits filtered by deposit address, polled until everything at
 * the address is terminal. A 404 is a contract violation and throws, same as
 * useDeposit — the address came from the backend's own POST
 * /v1/deposit-address.
 */
export function useDeposits(depositAddress: string) {
  const { depositApiUrl } = useConfig()
  const api = useDepositApi()
  const mountedAt = useMountedAt()
  return useQuery({
    queryKey: depositQueryKeys.deposits(depositAddress).queryKey,
    queryFn: async (): Promise<Deposit[]> => {
      try {
        // No bucket validation: unknown buckets are handled fail-closed
        // downstream (isTerminalBucket stops polling, displayBucket renders
        // failed), so one weird old deposit at this reused address cannot
        // poison discovery.
        const { deposits } = await api
          .get("v1/deposits", { searchParams: { deposit_address: depositAddress } })
          .json<ListDepositsResponse>()
        return assertDepositsAtAddress(deposits, depositAddress)
      } catch (error) {
        // Keep the typed mismatch error; consumers branch on it.
        if (error instanceof DepositAddressMismatchError) throw error
        throw await normalizeError(error)
      }
    },
    enabled: !!depositApiUrl && !!depositAddress,
    refetchInterval: (query) => pollUntilAllTerminal(query.state.data, Date.now() - mountedAt),
  })
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
  /** Deterministic deposit address from useDepositAddress; the server filters the list by it. */
  depositAddress: string
}

export interface TrackedDeposit {
  /** The discovered deposit, or null while still waiting for detection. */
  deposit: Deposit | null
  isError: boolean
  error: Error | null
}

/**
 * Selects the deposit to track from the address-filtered list: the newest
 * in-progress deposit — the address is deterministic, so a stale completed
 * one can coexist and must not mask the new transfer — else the newest
 * terminal one, so a finished deposit still resolves.
 */
export function selectTrackedDeposit(deposits: Deposit[] | undefined): Deposit | null {
  if (!deposits) return null
  // An unparseable created_at sorts as 0 (oldest). Spread-and-sort instead of
  // toSorted (this tsconfig's lib < es2023). Unknown buckets need no
  // exclusion: isTerminalBucket counts them terminal, so they cannot shadow
  // the real in-progress transfer.
  const createdAt = (deposit: Deposit) => Date.parse(deposit.created_at) || 0
  const matches = [...deposits].sort((a, b) => createdAt(b) - createdAt(a))
  return matches.find((deposit) => !isTerminalBucket(deposit.bucket)) ?? matches[0] ?? null
}

/**
 * Discovers and polls the deposit for a transfer (the tracking screen's data
 * source). The list is polled while anything at the address is in flight —
 * the address is deterministic, so the tracked transfer may sit behind a
 * stale terminal match. Once everything is terminal both polls stop: the
 * tracking question is answered, and the next arrival is the advance
 * screens' question (useNewDeposits).
 */
export function useTrackedDeposit({ depositAddress }: TrackedDepositParams): TrackedDeposit {
  const list = useDeposits(depositAddress)
  const matched = useMemo(() => selectTrackedDeposit(list.data), [list.data])

  const id = matched?.id ?? ""
  const detail = useDeposit(id)

  // Prefer the authoritative single-deposit record; fall back to the list
  // match so the UI updates as soon as anything is found.
  const deposit = detail.data ?? matched ?? null

  return {
    deposit,
    isError: list.isError || detail.isError,
    error: list.error ?? detail.error ?? null,
  }
}
