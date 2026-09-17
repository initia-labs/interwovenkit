import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import Button from "@/components/Button"
import { safeExplorerUrl } from "@/components/explorer"
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
  useDeposit,
} from "../data/deposits"
import { eqAddress } from "../data/parse"
import { findDestinationNetwork, formatSourceMin } from "../data/source"
import type { BridgeStatusResponse, Deposit } from "../data/types"
import { formatCompletedAmount } from "../completedAmount"
import { DepositTrackingView, TAKING_LONGER_DELAY } from "../DepositTracking"
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
import { findPinnedProvider, type SourceTxOutcome, watchSourceTransaction } from "./evmRpc"
import { useTransferForm } from "./transferFlowConfig"

// A watch window that times out is reported as `pending`, never as a failure.
const SOURCE_WATCH_TIMEOUT = 20_000
const SOURCE_WATCH_INTERVAL = 5_000

// Every "failed" / "completed" judgment lives in `deriveDepositProgress`, which
// keeps it unit-testable; this file only runs the reads that feed it.
const DepositProgress = () => {
  const { watch } = useTransferForm()
  const sessionId = watch("depositSessionId")
  const store = useDepositSessionStore()
  const { closeModal } = useModal()

  const session = sessionId ? store.read(sessionId) : null

  if (!session) {
    // Nothing left to read or refresh, and no claim to make about the transfer itself.
    return (
      <DepositTrackingView
        title="Deposit status"
        variant="problem"
        heading="Deposit not found"
        message="This deposit is no longer saved in this browser. Any transfer already sent is unaffected."
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

  // Keyed remount on a session switch so every stage timer below restarts.
  return <DepositProgressTracker key={session.id} session={session} />
}

interface TrackerProps {
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

  // Reads current state from a ref: a fresh session object per render must not
  // re-arm the effects that call this into a write loop.
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

  // Source-chain-pinned reads, never the wallet's own provider.
  const provider = findPinnedProvider(session.source.chainId)

  const sourceQuery = useQuery({
    // Session id + watched hash already identify the remaining inputs, which are
    // the session's own immutable intent.
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    queryKey: depositQueryKeys.sourceWatch(session.id, sourceHash).queryKey,
    queryFn: (): Promise<SourceTxOutcome> =>
      watchSourceTransaction(provider!, {
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
      }),
    enabled: !!provider && !!sourceHash && !depositId,
    // The interval is the retry: a thrown RPC error is an evidence gap the
    // screen renders as "still checking", not a query that should give up.
    retry: false,
    staleTime: 0,
    refetchInterval: (query) =>
      !query.state.data || query.state.data.status === "pending" ? SOURCE_WATCH_INTERVAL : false,
  })
  const sourceOutcome = sourceQuery.data

  // A repriced replacement is the same intent at a new hash, so tracking follows
  // it and keeps the original for support.
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

  // One clock for both backend polls: the tracker remounts per session (keyed above).
  const [startedAt] = useState(() => Date.now())
  const bridgeQuery = useQuery(
    createBridgeStatusQueryOptions(
      api,
      {
        srcChainId: session.source.chainId,
        srcTxHash: sourceHash,
        depositAddress: session.depositAddress,
      },
      // Polled alongside the receipt watch: the backend's own view of the source
      // transaction must not wait on a third-party RPC.
      session.transport === "lifi" && !depositId && !!sourceHash,
      startedAt,
    ),
  )
  const bridgeStatus = bridgeQuery.data

  // A deposit that cannot be proven to be this user's is a tracking conflict,
  // never a completion.
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

  const directQuery = useQuery(
    createDepositBySourceTxQueryOptions(
      api,
      sourceHash,
      session.transport === "direct" && !depositId && !!sourceHash,
      startedAt,
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
  useEffect(() => {
    if (!handoffId) return
    applyPatch({ depositId: handoffId, phase: "deposit_indexed" })
  }, [handoffId, applyPatch])

  const depositQuery = useDeposit(depositId)
  const deposit = depositQuery.data ?? null
  const bucket = classifyWalletBucket(deposit)

  // Non-suspending catalog read: suspending here would blank a screen that is
  // already reporting on money in flight.
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
    source: { outcome: sourceOutcome, isError: sourceQuery.isError },
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
      isSelfRecipient: !!initiaAddress && eqAddress(session.destination.recipient, initiaAddress),
    },
  }

  // The stage key comes from the undelayed derivation: letting the flag reach it
  // would make arming the timer change its own trigger.
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

  const explorerUrl = resolveExplorerUrl(deposit, bridgeStatus)

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

  // Storage could not hold this transfer, so the reference is the user's only
  // durable copy.
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

// Explorer link in evidence order: fast delivery, bridge submission, then the
// provider's own links. Never a claim that the flow completed.
function resolveExplorerUrl(
  deposit: Deposit | null,
  bridgeStatus: BridgeStatusResponse | undefined,
): string | undefined {
  const fromDeposit = deposit?.advance_tx_explorer_url || deposit?.bot_tx_explorer_url
  return safeExplorerUrl(fromDeposit || bridgeStatus?.dst_tx_link || bridgeStatus?.src_tx_link)
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
      // Clipboard permission denied: the text is on screen and selectable.
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

// Chips render from the saved session identity alone, so a transfer in flight can
// be watched without a Router or registry read succeeding first.
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
