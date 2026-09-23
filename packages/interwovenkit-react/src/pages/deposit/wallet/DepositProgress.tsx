import { whereEq } from "ramda"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useInterval } from "usehooks-ts"
import { useQuery } from "@tanstack/react-query"
import Button from "@/components/Button"
import CopyButton from "@/components/CopyButton"
import { safeExplorerUrl } from "@/components/explorer"
import Footer from "@/components/Footer"
import { useConfig } from "@/data/config"
import { useDrawer, useModal } from "@/data/ui"
import { useInitiaAddress } from "@/public/data/hooks"
import { depositQueryKeys, useDepositApi } from "../data/api"
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
import FlowChips from "../FlowChips"
import {
  checkHashlessSend,
  type DepositProgressInputs,
  deriveDepositProgress,
} from "./depositProgressLogic"
import { type DepositSession, recoveryReference, useDepositSessionStore } from "./depositSession"
import { depositApiRpcUrl, findDepositApiSource, findEthereumUsdcRoute } from "./depositSources"
import {
  getPinnedProvider,
  type SourceTxOutcome,
  useSenderNonces,
  watchSourceTransaction,
} from "./evmRpc"
import { useTransferForm } from "./transferFlowConfig"
import styles from "./DepositProgress.module.css"

// Long enough that ethers' replacement scan rarely restarts; the refetch interval is the outer loop.
const SOURCE_WATCH_TIMEOUT = 90_000
const SOURCE_WATCH_INTERVAL = 5_000
const NONCE_POLL_INTERVAL = 5_000

const DepositProgress = () => {
  const { watch } = useTransferForm()
  const sessionId = watch("depositSessionId")
  const store = useDepositSessionStore()
  const { closeModal } = useModal()

  const session = useMemo(() => (sessionId ? store.read(sessionId) : null), [store, sessionId])

  if (!session) {
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

  // Keyed so every stage timer restarts on a session switch.
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
  const { read, write, isVolatile } = useDepositSessionStore()

  // Stable across store revisions, so the effects below re-run only when their own values change.
  const applyPatch = useCallback(
    (patch: Partial<DepositSession>) => {
      const current = read(session.id)
      if (!current || whereEq(patch, current)) return
      write({ ...current, ...patch })
    },
    [read, write, session.id],
  )

  const sourceHash = session.currentSourceHash ?? ""
  const depositId = session.depositId ?? ""
  const isHashlessSend =
    !sourceHash && (session.phase === "send_prompt" || session.phase === "submission_unknown")

  const noncesQuery = useSenderNonces(
    session.source.chainId,
    isHashlessSend && session.promptNonce !== undefined ? session.source.sender : "",
    NONCE_POLL_INTERVAL,
  )

  const sourceQuery = useQuery({
    // The session id and watched hash identify every other input: the session's immutable intent.
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    queryKey: depositQueryKeys.sourceWatch(session.id, sourceHash).queryKey,
    queryFn: (): Promise<SourceTxOutcome> =>
      watchSourceTransaction(getPinnedProvider(session.source.chainId), {
        hash: sourceHash,
        from: session.submitted?.from ?? session.source.sender,
        // Missing evidence degrades the watch to a plain receipt read.
        nonce: session.submitted?.nonce ?? -1,
        to: session.transaction.to,
        data: session.transaction.data,
        value: session.transaction.value,
        chainId: session.transaction.chainId,
        startBlock: session.preSubmitBlock ?? -1,
        timeoutMs: SOURCE_WATCH_TIMEOUT,
      }),
    enabled: !!depositApiRpcUrl(session.source.chainId) && !!sourceHash && !depositId,
    // The interval is the retry: an RPC error is an evidence gap, not a reason to give up.
    retry: false,
    staleTime: 0,
    refetchInterval: (query) =>
      !query.state.data || query.state.data.status === "pending" ? SOURCE_WATCH_INTERVAL : false,
  })
  const sourceOutcome = sourceQuery.data

  // A repriced replacement is the same intent at a new hash; `originalSourceHash` keeps the first.
  const replacementHash =
    sourceOutcome?.status === "replaced" && sourceOutcome.reason === "repriced"
      ? sourceOutcome.hash
      : ""
  useEffect(() => {
    if (replacementHash) applyPatch({ currentSourceHash: replacementHash })
  }, [replacementHash, applyPatch])

  const [startedAt] = useState(() => Date.now())
  const bridgeQuery = useQuery(
    createBridgeStatusQueryOptions(
      api,
      {
        srcChainId: session.source.chainId,
        srcTxHash: sourceHash,
        depositAddress: session.depositAddress,
      },
      // Alongside the receipt watch: the backend's view must not wait on a third-party RPC.
      session.transport === "lifi" && !depositId && !!sourceHash,
      startedAt,
    ),
  )
  const bridgeStatus = bridgeQuery.data

  const identity = {
    depositAddress: session.depositAddress,
    dstChainId: session.destination.chainId,
    dstDenom: session.destination.denom,
    recipient: session.destination.recipient,
  }
  const indexedDeposit = bridgeStatus?.state === "deposit_indexed" ? bridgeStatus.deposit : null
  const lifiHandoff = indexedDeposit
    ? checkHandoff(() =>
        assertLifiDeposit(indexedDeposit, { ...identity, dstTxHash: bridgeStatus?.dst_tx_hash }),
      )
    : undefined

  const directQuery = useQuery(
    createDepositBySourceTxQueryOptions(
      api,
      sourceHash,
      session.transport === "direct" && !depositId && !!sourceHash,
      startedAt,
    ),
  )
  const directRecord = directQuery.data

  const directHandoff = directRecord
    ? checkHandoff(() =>
        assertDirectDeposit(directRecord, {
          ...identity,
          srcTxHash: sourceHash,
          amount: session.source.amount,
        }),
      )
    : undefined

  const handoffId = lifiHandoff?.deposit?.id ?? directHandoff?.deposit?.id ?? ""
  useEffect(() => {
    if (!handoffId) return
    applyPatch({ depositId: handoffId })
  }, [handoffId, applyPatch])

  const depositQuery = useDeposit(depositId)
  const deposit = depositQuery.data ?? null
  const bucket = classifyWalletBucket(deposit)
  const estimatedCompletionAt = deposit?.delivery?.estimated_completion_at

  const [now, setNow] = useState(Date.now)
  const isCountingDown =
    !!estimatedCompletionAt && (bucket === "waiting" || bucket === "processing")
  useInterval(() => setNow(Date.now()), isCountingDown || isHashlessSend ? 10_000 : null)

  // Non-suspending: suspending would blank a screen already reporting on money in flight.
  const assetsQuery = useQuery({
    ...createDepositAssetsQueryOptions(api),
    enabled: !!depositApiUrl,
  })
  const ethereumRoute = findEthereumUsdcRoute(assetsQuery.data)
  const minLabel =
    deposit?.required_min_amount && ethereumRoute
      ? formatSourceMin(deposit.required_min_amount, ethereumRoute.src_decimals, "USDC")
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
    // The record's own fetch time keeps the first reading fresh before the interval ticks.
    now: Math.max(now, depositQuery.dataUpdatedAt),
    nonces: {
      data: noncesQuery.data,
      readAt: noncesQuery.dataUpdatedAt,
      isError: noncesQuery.isError,
    },
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
      delivery: deposit?.delivery,
      isError: depositQuery.isError,
      minLabel,
      completedAmount,
      isSelfRecipient: !!initiaAddress && eqAddress(session.destination.recipient, initiaAddress),
    },
  }

  // Keyed on the undelayed view, or arming the timer would change its own trigger.
  const baseView = deriveDepositProgress(session, { ...inputs, isDelayed: false })
  const stageKey = `${baseView.variant}:${baseView.persist?.lastState ?? ""}`
  const [delayedStage, setDelayedStage] = useState<string | null>(null)
  const isDelayed = delayedStage === stageKey && baseView.variant === "in-flight"
  useEffect(() => {
    const timer = setTimeout(() => setDelayedStage(stageKey), TAKING_LONGER_DELAY)
    return () => clearTimeout(timer)
  }, [stageKey])

  const view = isDelayed ? deriveDepositProgress(session, { ...inputs, isDelayed: true }) : baseView

  // Re-checked against the stored record: another tab may have recorded a hash or a heartbeat since.
  const { data: nonceData, dataUpdatedAt: nonceReadAt, isError: nonceError } = noncesQuery
  const releaseNotSent = useCallback(
    (manual: boolean) => {
      const current = read(session.id)
      if (!current || current.currentSourceHash) return
      if (current.phase !== "send_prompt" && current.phase !== "submission_unknown") return
      const nonces = { data: nonceData, readAt: nonceReadAt, isError: nonceError }
      const check = checkHashlessSend(current, nonces, Date.now())
      if (!(manual ? check.canMarkNotSent : check.release)) return
      write({ ...current, phase: "terminal", lastState: "not_sent" })
    },
    [read, write, session.id, nonceData, nonceReadAt, nonceError],
  )

  const persistPhase = view.persist?.phase
  const persistLastState = view.persist?.lastState
  useEffect(() => {
    if (persistLastState === "not_sent") {
      releaseNotSent(false)
      return
    }
    applyPatch({
      ...(persistPhase && { phase: persistPhase }),
      ...(persistLastState && { lastState: persistLastState }),
    })
  }, [persistPhase, persistLastState, applyPatch, releaseNotSent])

  const explorerUrl = resolveExplorerUrl(deposit, bridgeStatus)

  const refresh = () => {
    for (const query of [sourceQuery, bridgeQuery, directQuery, depositQuery]) {
      if (query.isEnabled) void query.refetch()
    }
  }

  const footer =
    view.showClose || view.showRefresh ? (
      <Footer>
        {view.canMarkNotSent && (
          <Button.Outline fullWidth onClick={() => releaseNotSent(true)}>
            I didn't send this
          </Button.Outline>
        )}
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
    ) : null

  const message = view.note ? (
    <>
      {view.message}
      <br />
      {view.note}
    </>
  ) : (
    view.message
  )

  // Storage could not hold this transfer, so the reference is the user's only durable copy.
  const showRecovery = isVolatile(session.id)

  return (
    <DepositTrackingView
      title={view.title}
      variant={view.variant}
      heading={view.heading}
      message={message}
      chips={
        <>
          {view.showChips && <ProgressChips session={session} />}
          {showRecovery && <RecoveryReference session={session} />}
        </>
      }
      explorerUrl={explorerUrl}
      onHistoryClick={view.variant === "completed" ? () => openDrawer("/activity") : undefined}
      footer={footer}
      isRetrying={view.isRetrying}
    />
  )
}

// A deposit that cannot be proven to be this user's is a tracking conflict, never a completion.
function checkHandoff(assert: () => Deposit): { deposit?: Deposit; error?: string } {
  try {
    return { deposit: assert() }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function resolveExplorerUrl(
  deposit: Deposit | null,
  bridgeStatus: BridgeStatusResponse | undefined,
): string | undefined {
  const fromDeposit = deposit?.advance_tx_explorer_url || deposit?.bot_tx_explorer_url
  return safeExplorerUrl(fromDeposit || bridgeStatus?.dst_tx_link || bridgeStatus?.src_tx_link)
}

const RecoveryReference = ({ session }: { session: DepositSession }) => {
  const reference = recoveryReference(session)
  return (
    <div className={styles.recovery}>
      <p className={styles.recoveryHeading}>Save your transfer details</p>
      <pre className={styles.recoveryText}>{reference}</pre>
      <CopyButton value={reference}>
        {({ copy, copied }) => (
          <Button.Small onClick={copy}>{copied ? "Copied" : "Copy recovery details"}</Button.Small>
        )}
      </CopyButton>
    </div>
  )
}

// From the saved session alone, so a transfer in flight can be watched without a registry read.
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
