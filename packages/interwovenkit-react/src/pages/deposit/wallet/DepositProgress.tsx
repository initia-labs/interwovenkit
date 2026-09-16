import xss from "xss"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import Button from "@/components/Button"
import { sanitizeLink } from "@/components/explorer"
import Footer from "@/components/Footer"
import { useConfig } from "@/data/config"
import { useDrawer, useModal } from "@/data/ui"
import { useInitiaAddress } from "@/public/data/hooks"
import { depositQueryKeys, useDepositApi } from "../data/api"
import { normalizeDenom } from "../data/assetOptions"
import { createDepositAssetsQueryOptions } from "../data/assets"
import { createBridgeStatusQueryOptions } from "../data/bridges"
import {
  assertDirectDeposit,
  assertLifiDeposit,
  classifyWalletBucket,
  createDepositBySourceTxQueryOptions,
  useWalletDeposit,
} from "../data/deposits"
import { findDestinationNetwork, formatSourceMin } from "../data/source"
import { formatCompletedAmount } from "../completedAmount"
import { DepositTrackingView } from "../DepositTracking"
import styles from "../DepositTracking.module.css"
import FlowChips from "../FlowChips"
import {
  type DepositProgressInputs,
  deriveDepositProgress,
  recoveryHeading,
  trackedSourceHash,
} from "./depositProgressLogic"
import { type DepositSession, recoveryReference, useDepositSessionStore } from "./depositSession"
import { ETHEREUM_CHAIN_ID, ETHEREUM_USDC_DENOM, findDepositApiSource } from "./depositSources"
import { type SourceTxOutcome, useSourceChainProvider, watchSourceTransaction } from "./evmRpc"
import { useTransferForm } from "./transferFlowConfig"

// One watch window per poll. Long enough that most confirmations resolve inside
// a single call, short enough that a stuck window still re-renders the screen —
// the timeout is reported as `pending`, never as a failure.
const SOURCE_WATCH_TIMEOUT = 20_000
const SOURCE_WATCH_INTERVAL = 5_000
// Same per-stage stall budget the address tracker uses.
const TAKING_LONGER_DELAY = 60 * 1000

/**
 * Progress controller for a saved Deposit API session.
 *
 * Everything it decides lives in `deriveDepositProgress`; this file only runs
 * the reads that feed it, persists what the derivation says to persist, and
 * renders the shared tracking body. The split is deliberate: the screen reports
 * on funds that have already left the wallet, so every "this failed" / "this
 * completed" judgment has to be unit-testable without a browser.
 */
const DepositProgress = () => {
  const { watch } = useTransferForm()
  const sessionId = watch("depositSessionId")
  const fallback = watch("depositSessionFallback")
  const store = useDepositSessionStore()
  const { closeModal } = useModal()

  // The form's in-memory copy only applies when the post-send storage write
  // failed for *this* session. Adopting it into the
  // store's volatile map keeps one read path: stored, else volatile, else none.
  const adoptable = fallback && fallback.id === sessionId ? fallback : undefined
  useEffect(() => {
    if (adoptable) store.remember(adoptable)
  }, [adoptable, store])
  const base = sessionId ? (store.read(sessionId) ?? adoptable ?? null) : null

  if (!base) {
    const view = deriveDepositProgress(null, EMPTY_INPUTS)
    return (
      <DepositTrackingView
        title={view.title}
        variant={view.variant}
        heading={view.heading}
        message={view.message}
        footer={
          <Footer>
            <Button.Outline fullWidth onClick={closeModal}>
              Close
            </Button.Outline>
          </Footer>
        }
      />
    )
  }

  // Remounts on a session switch so every stage timer below starts from the new
  // session's own state.
  return <DepositProgressTracker key={base.id} session={base} />
}

/** Placeholder inputs for the "no session" branch, which reads none of them. */
const EMPTY_INPUTS: DepositProgressInputs = {
  source: { isError: false, hasProvider: false },
  bridge: {},
  direct: { isError: false },
  deposit: { bucket: "waiting", isError: false, isSelfRecipient: false },
  isDelayed: false,
}

interface TrackerProps {
  /** The current record: storage first, else the store's in-memory copy. */
  session: DepositSession
}

const DepositProgressTracker = ({ session }: TrackerProps) => {
  const api = useDepositApi()
  const { depositApiUrl } = useConfig()
  const { closeModal } = useModal()
  const { openDrawer } = useDrawer()
  const initiaAddress = useInitiaAddress()
  const store = useDepositSessionStore()

  // Latest-value refs, synced in an effect (never during render) and declared
  // before every effect that calls applyPatch, so those read current values.
  const sessionRef = useRef(session)
  const storeRef = useRef(store)
  useEffect(() => {
    sessionRef.current = session
    storeRef.current = store
  })

  /**
   * Writes a field patch through the session store, which keeps it in memory
   * when storage cannot hold it (the store re-renders us either way). Takes its
   * current state from a ref: every caller is an effect keyed on primitives, so
   * a fresh session object per render cannot re-arm them into a write loop.
   */
  const applyPatch = useCallback((patch: Partial<DepositSession>) => {
    const current = sessionRef.current
    const fields = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ) as Partial<DepositSession>
    const changed = Object.entries(fields).some(
      ([key, value]) => current[key as keyof DepositSession] !== value,
    )
    if (changed) storeRef.current.write({ ...current, ...fields })
  }, [])

  const sourceHash = trackedSourceHash(session)
  const depositId = session.depositId ?? ""

  // Source-chain-pinned reads, never the wallet's own provider (null when the
  // chain cannot be read: rendered as "cannot verify", never thrown).
  const sourceChainId = session.source.chainId
  const provider = useSourceChainProvider(sourceChainId)

  const sourceQuery = useQuery({
    // The remaining inputs are the session's own immutable intent (the exact
    // call saved before signing) and the provider derived from its source
    // chain. Session id + watched hash already identify them; listing them
    // again would only re-key the watch on a field that cannot change.
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    queryKey: depositQueryKeys.sourceWatch(session.id, sourceHash).queryKey,
    queryFn: async (): Promise<SourceTxOutcome> => {
      if (!provider) throw new Error(`No pinned RPC for chain ${sourceChainId}`)
      return watchSourceTransaction(provider, {
        hash: sourceHash,
        from: session.submitted?.from ?? session.source.sender,
        // Missing nonce/start-block evidence degrades the watch to a plain
        // receipt read (see watchSourceTransaction); it never fabricates one.
        nonce: session.submitted?.nonce ?? -1,
        to: session.transaction.to,
        data: session.transaction.data,
        value: session.transaction.value,
        chainId: session.transaction.chainId,
        startBlock: session.preSubmitBlock ?? -1,
        timeoutMs: SOURCE_WATCH_TIMEOUT,
      })
    },
    enabled: !!provider && !!sourceHash && !depositId,
    // The interval is the retry: a thrown RPC error is an evidence gap the
    // screen renders as "still checking", not a query that should give up.
    retry: false,
    staleTime: 0,
    refetchInterval: (query) =>
      !query.state.data || query.state.data.status === "pending" ? SOURCE_WATCH_INTERVAL : false,
  })
  const sourceOutcome = sourceQuery.data

  // A repriced replacement is the same intent at a new hash (watchSourceTransaction
  // proves equivalence before reporting it), so tracking follows it and the
  // original is kept for history and support.
  const replacementHash =
    sourceOutcome?.status === "replaced" && sourceOutcome.reason === "repriced"
      ? sourceOutcome.hash
      : ""
  useEffect(() => {
    if (!replacementHash) return
    const current = sessionRef.current
    applyPatch({
      currentSourceHash: replacementHash,
      originalSourceHash: current.originalSourceHash ?? trackedSourceHash(current),
    })
  }, [replacementHash, applyPatch])

  // --- LI.FI: bridge status until the backend indexes the Ethereum deposit ---
  const [bridgeStartedAt] = useState(() => Date.now())
  const bridgeQuery = useQuery(
    createBridgeStatusQueryOptions(
      api,
      {
        srcChainId: session.source.chainId,
        srcTxHash: sourceHash,
        depositAddress: session.depositAddress,
      },
      // Polled alongside the receipt watch: the backend's own observation of
      // the source transaction must not wait on a third-party RPC.
      session.transport === "lifi" && !depositId && !!sourceHash,
      bridgeStartedAt,
    ),
  )
  const bridgeStatus = bridgeQuery.data

  // The handoff gate. A deposit that cannot be proven to be this user's is a
  // tracking problem, never a completion — so the assertion result is carried
  // as either a record or a conflict message, and nothing in between.
  const lifiHandoff = useMemo(() => {
    if (bridgeStatus?.state !== "deposit_indexed" || !bridgeStatus.deposit) return undefined
    try {
      return {
        deposit: assertLifiDeposit(bridgeStatus.deposit, {
          depositAddress: session.depositAddress,
          dstChainId: session.destination.chainId,
          dstDenom: session.destination.denom,
          recipient: session.destination.recipient,
          ethereumUsdc: ETHEREUM_USDC_DENOM,
          dstTxHash: bridgeStatus.dst_tx_hash,
        }),
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }, [bridgeStatus, session.depositAddress, session.destination])

  // --- Direct Ethereum: exact source-hash correlation ---
  const directQuery = useQuery(
    createDepositBySourceTxQueryOptions(
      api,
      { srcChainId: "1", srcTxHash: sourceHash },
      session.transport === "direct" && !depositId && !!sourceHash,
    ),
  )
  const directRecord = directQuery.data

  const directHandoff = useMemo(() => {
    if (!directRecord) return undefined
    try {
      return {
        deposit: assertDirectDeposit(directRecord, {
          srcTxHash: sourceHash,
          amount: session.source.amount,
          srcDenom: session.source.denom,
          depositAddress: session.depositAddress,
          dstChainId: session.destination.chainId,
          dstDenom: session.destination.denom,
          recipient: session.destination.recipient,
        }),
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }, [directRecord, sourceHash, session.source, session.depositAddress, session.destination])

  const handoffId = lifiHandoff?.deposit?.id ?? directHandoff?.deposit?.id ?? ""
  // LI.FI's nested Deposit identifies the Ethereum receiving transaction, not
  // the Base/Arbitrum one the user signed.
  const handoffEthereumHash = lifiHandoff?.deposit?.src_tx_hash ?? ""
  useEffect(() => {
    if (!handoffId) return
    applyPatch({
      depositId: handoffId,
      ethereumTxHash: handoffEthereumHash || undefined,
      phase: "deposit_indexed",
    })
  }, [handoffId, handoffEthereumHash, applyPatch])

  // --- Deposit id: the authoritative lifecycle ---
  const depositQuery = useWalletDeposit(depositId)
  const deposit = depositQuery.data ?? null
  const bucket = classifyWalletBucket(deposit)

  // Non-suspending catalog read: the below-minimum copy needs the Ethereum
  // route's decimals, and suspending here would blank a screen that is already
  // reporting on money in flight.
  const assetsQuery = useQuery({
    ...createDepositAssetsQueryOptions(api),
    enabled: !!depositApiUrl,
  })
  const ethereumRoute = assetsQuery.data?.find(
    (asset) =>
      asset.src_chain_id === ETHEREUM_CHAIN_ID &&
      normalizeDenom(asset.src_denom) === normalizeDenom(ETHEREUM_USDC_DENOM),
  )
  const minLabel =
    deposit?.required_min_amount && ethereumRoute
      ? // Rounds up: understating the minimum would invite a repeat deposit that
        // lands below it again.
        formatSourceMin(deposit.required_min_amount, ethereumRoute.src_decimals, "USDC")
      : ""

  const dstNetwork =
    deposit && ethereumRoute
      ? findDestinationNetwork(ethereumRoute, deposit.dst_chain_id, deposit.dst_denom)
      : undefined
  const completedAmount = formatCompletedAmount({
    amountOut: deposit?.amount_out,
    sentAmount: deposit?.amount,
    dstDecimals: dstNetwork?.decimals,
    srcDecimals: ethereumRoute?.src_decimals,
    receiveSymbol: session.destination.symbol,
    sentSymbol: "USDC",
  })

  const inputs: Omit<DepositProgressInputs, "isDelayed"> = {
    source: {
      outcome: sourceOutcome,
      isError: sourceQuery.isError,
      hasProvider: !!provider,
    },
    bridge: {
      state: bridgeStatus?.state,
      error: bridgeQuery.error,
      conflict: lifiHandoff?.error,
    },
    direct: {
      found: directQuery.isFetched ? !!directRecord : undefined,
      isError: directQuery.isError,
      conflict: directHandoff?.error,
    },
    deposit: {
      bucket,
      advanceStatus: deposit?.advance_status,
      isError: depositQuery.isError,
      minLabel,
      completedAmount,
      isSelfRecipient:
        !!initiaAddress &&
        session.destination.recipient.toLowerCase() === initiaAddress.toLowerCase(),
    },
  }

  // The stall budget is armed per stage, so each leg gets its own minute. The
  // stage key is taken from the undelayed derivation, which the flag cannot
  // influence — otherwise arming the timer would change its own trigger.
  const baseView = deriveDepositProgress(session, { ...inputs, isDelayed: false })
  const stageKey = `${baseView.stage}:${baseView.persist?.lastState ?? ""}`
  const [delayedStage, setDelayedStage] = useState<string | null>(null)
  const isDelayed = delayedStage === stageKey && baseView.variant === "in-flight"
  useEffect(() => {
    const timer = setTimeout(() => setDelayedStage(stageKey), TAKING_LONGER_DELAY)
    return () => clearTimeout(timer)
  }, [stageKey])

  const view = isDelayed ? deriveDepositProgress(session, { ...inputs, isDelayed: true }) : baseView

  const persistPhase = view.persist?.phase
  const persistLastState = view.persist?.lastState
  useEffect(() => {
    if (!persistPhase && !persistLastState) return
    applyPatch({ phase: persistPhase, lastState: persistLastState })
  }, [persistPhase, persistLastState, applyPatch])

  // Explorer preference, in evidence order: the fast-delivery submission, the
  // ordinary bridge submission, then the bridge provider's own links. A link is
  // never a claim that the flow completed.
  const explorerUrl = (() => {
    const fromDeposit = deposit?.advance_tx_explorer_url || deposit?.bot_tx_explorer_url
    const raw = fromDeposit || bridgeStatus?.dst_tx_link || bridgeStatus?.src_tx_link
    return raw ? xss(sanitizeLink(raw)) : undefined
  })()

  const refresh = () => {
    void sourceQuery.refetch()
    void bridgeQuery.refetch()
    void directQuery.refetch()
    void depositQuery.refetch()
  }

  const footer =
    view.showClose || view.showRefresh ? (
      <Footer>
        {view.showRefresh && (
          <Button.White fullWidth onClick={refresh}>
            Refresh
          </Button.White>
        )}
        {view.showClose && (
          <Button.Outline fullWidth onClick={closeModal}>
            Close
          </Button.Outline>
        )}
      </Footer>
    ) : // Nothing to press while the transfer is in flight: closing the widget
    // does not stop it, and no button here can make it go faster.
    null

  const message = view.note ? (
    <>
      {view.message}
      <br />
      {view.note}
    </>
  ) : (
    view.message
  )

  // Storage could not hold this transfer, so the reference is the only durable
  // copy the user has. Shown alongside live progress, never instead of it.
  const showRecovery = store.isVolatile(session.id)

  return (
    <DepositTrackingView
      title={view.title}
      variant={view.variant}
      heading={view.heading}
      message={message}
      chips={view.showChips ? <ProgressChips session={session} /> : undefined}
      explorerUrl={explorerUrl}
      onHistoryClick={view.variant === "completed" ? () => openDrawer("/activity") : undefined}
      footer={footer}
      isRetrying={view.isRetrying}
      extra={showRecovery ? <RecoveryReference session={session} /> : undefined}
    />
  )
}

/** Copyable support reference for a transfer this browser could not save. */
const RecoveryReference = ({ session }: { session: DepositSession }) => {
  const [copied, setCopied] = useState(false)
  const reference = recoveryReference(session)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reference)
      setCopied(true)
    } catch {
      // Clipboard permission denied: the text is on screen and selectable, so
      // there is nothing to recover from beyond leaving the button as it was.
      setCopied(false)
    }
  }

  return (
    <div className={styles.recovery}>
      <p className={styles.recoveryHeading}>{recoveryHeading}</p>
      <pre className={styles.recoveryText}>{reference}</pre>
      <Button.Small onClick={copy}>{copied ? "Copied" : "Copy recovery details"}</Button.Small>
    </div>
  )
}

/**
 * Source and destination chips from the saved identity alone. The chain logos
 * were captured when the session was created and the token art comes from the
 * registry CDN by symbol, so a transfer in flight can always be watched without
 * a Router or registry read succeeding first.
 */
const ProgressChips = ({ session }: { session: DepositSession }) => {
  const { registryUrl } = useConfig()
  const { source, destination } = session
  const sourceChainLogoUrl =
    source.chainLogoUrl || findDepositApiSource(source.chainId, source.denom)?.fallbackChainLogoUrl
  return (
    <FlowChips
      steps={[
        {
          label: "You sent",
          logoUrl: `${registryUrl}/images/${source.symbol}.png`,
          chainLogoUrl: sourceChainLogoUrl ?? "",
          text: source.symbol,
        },
        {
          label: "You receive",
          logoUrl: `${registryUrl}/images/${destination.symbol}.png`,
          chainLogoUrl: destination.chainLogoUrl ?? "",
          text: destination.symbol,
        },
      ]}
    />
  )
}

export default DepositProgress
