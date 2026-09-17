import type { KyInstance } from "ky"
import { HTTPError } from "ky"
import { useState } from "react"
import { queryOptions, useQuery } from "@tanstack/react-query"
import { useConfig } from "@/data/config"
import { normalizeError } from "@/data/http"
import { depositQueryKeys, useDepositApi } from "./api"
import { normalizeDenom } from "./assetOptions"
import { assertField } from "./parse"
import type { Deposit, DepositBucket, ListDepositsResponse } from "./types"
import { ACTIVE_DEPOSIT_BUCKETS, DEPOSIT_BUCKETS } from "./types"

// Every Deposit API transfer lands on Ethereum, so correlation by source
// transaction is always scoped to chain 1.
const ETHEREUM_CHAIN_ID = "1"

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

interface TrackedDeposit {
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

// An unknown wire bucket keeps its own name instead of collapsing onto "failed"
// like displayBucket: the user has just signed a real transfer, so this is a
// tracking-contract problem, not a financial failure.
export type WalletDepositBucket = DepositBucket | "unknown"

/** Null is the pre-discovery frame (waiting); an unrecognized wire bucket stays "unknown". */
export function classifyWalletBucket(deposit: Deposit | null): WalletDepositBucket {
  if (!deposit) return "waiting"
  return isDepositBucket(deposit.bucket) ? deposit.bucket : "unknown"
}

/** Stop once the record exists; the deposit id takes over from there. */
export const bySourceTxPollInterval = (deposit: Deposit | null | undefined, elapsedMs: number) =>
  deposit ? false : pollInterval(elapsedMs)

// Correlates by source transaction hash, never by address or cursor discovery:
// a list scan could attach an unrelated transfer at the same reused address to
// this session. A 404 is data, not an error — the indexer simply has not
// observed the transfer yet. Only the Ethereum leg is ever correlated this way
// (the LI.FI legs hand off through GET /v1/bridges/status), so the chain is fixed.
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

/** The saved session identity a directly transferred deposit must match exactly. */
interface DirectDepositIdentity {
  srcTxHash: string
  /** Ethereum base units actually transferred. */
  amount: string
  srcDenom: string
  depositAddress: string
  dstChainId: string
  dstDenom: string
  /** Final credited wallet, init bech32 lowercase. */
  recipient: string
}

// An off-by-one field here would track — and eventually declare complete —
// somebody else's deposit at the same reused address. Amount is compared because
// the direct executor sends exactly one transfer of a known size.
export function assertDirectDeposit(deposit: Deposit, identity: DirectDepositIdentity): Deposit {
  assertField(
    deposit.src_chain_id === ETHEREUM_CHAIN_ID,
    `Deposit record src_chain_id is ${deposit.src_chain_id}, not Ethereum ("1")`,
  )
  assertField(
    deposit.src_tx_hash.toLowerCase() === identity.srcTxHash.toLowerCase(),
    `Deposit record src_tx_hash ${deposit.src_tx_hash} is not the submitted ${identity.srcTxHash}`,
  )
  assertField(
    deposit.amount === identity.amount,
    `Deposit record amount ${deposit.amount} is not the transferred ${identity.amount}`,
  )
  assertField(
    normalizeDenom(deposit.src_denom) === normalizeDenom(identity.srcDenom),
    `Deposit record src_denom ${deposit.src_denom} is not ${identity.srcDenom}`,
  )
  assertCommonDepositIdentity(deposit, identity)
  return deposit
}

/** The saved session identity a LI.FI-bridged deposit must match. */
interface LifiDepositIdentity {
  depositAddress: string
  dstChainId: string
  dstDenom: string
  recipient: string
  /** Canonical Ethereum USDC: the asset that actually lands at the deposit address. */
  ethereumUsdc: string
  dstTxHash?: string
}

// The deposit records the *Ethereum* leg: its chain, denom and hash belong to
// the receiving transaction, not the transfer the user signed, and the bridge
// delivers post-slippage. So identity rests on the issued address, Ethereum
// USDC, destination and recipient, plus the receiving hash when one is given.
export function assertLifiDeposit(deposit: Deposit, identity: LifiDepositIdentity): Deposit {
  assertField(
    deposit.src_chain_id === ETHEREUM_CHAIN_ID,
    `Deposit record src_chain_id is ${deposit.src_chain_id}, not Ethereum ("1")`,
  )
  assertField(
    normalizeDenom(deposit.src_denom) === normalizeDenom(identity.ethereumUsdc),
    `Deposit record src_denom ${deposit.src_denom} is not Ethereum USDC`,
  )
  if (identity.dstTxHash) {
    assertField(
      deposit.src_tx_hash.toLowerCase() === identity.dstTxHash.toLowerCase(),
      `Deposit record src_tx_hash ${deposit.src_tx_hash} is not the reported Ethereum delivery ${identity.dstTxHash}`,
    )
  }
  assertCommonDepositIdentity(deposit, identity)
  return deposit
}

function assertCommonDepositIdentity(
  deposit: Deposit,
  identity: Pick<DirectDepositIdentity, "depositAddress" | "dstChainId" | "dstDenom" | "recipient">,
): void {
  assertField(
    deposit.deposit_address.toLowerCase() === identity.depositAddress.toLowerCase(),
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
    deposit.wallet_address.toLowerCase() === identity.recipient.toLowerCase(),
    `Deposit record wallet_address ${deposit.wallet_address} is not the recipient ${identity.recipient}`,
  )
}
