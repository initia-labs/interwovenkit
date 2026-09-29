import { whereEq } from "ramda"
import xss from "xss"
import { useEffect, useEffectEvent, useMemo, useState } from "react"
import { useInterval } from "usehooks-ts"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  IconCheckCircleFilled,
  IconCloseCircleFilled,
  IconWarningFilled,
} from "@initia/icons-react"
import { fromBaseUnit } from "@initia/utils"
import Button from "@/components/Button"
import CopyButton from "@/components/CopyButton"
import { sanitizeLink } from "@/components/explorer"
import Footer from "@/components/Footer"
import Loader from "@/components/Loader"
import { useConfig } from "@/data/config"
import { useDrawer, useModal } from "@/data/ui"
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
import { ParseError } from "../data/parse"
import { findDestinationNetwork, formatSourceMin } from "../data/source"
import type { BridgeStatusResponse, Deposit } from "../data/types"
import { formatCompletedAmount, formatSentenceAmount } from "../completedAmount"
import DepositStatus from "../DepositStatus"
import DepositSubpage from "../DepositSubpage"
import { TAKING_LONGER_DELAY } from "../DepositTracking"
import trackingStyles from "../DepositTracking.module.css"
import ExplorerLinks from "../ExplorerLinks"
import FlowChips from "../FlowChips"
import {
  checkHashlessSend,
  DELAYED_HEADING,
  DELAYED_NOTE,
  type DepositProgressInputs,
  type DepositProgressVariant,
  deriveDepositProgress,
  deriveProgressSteps,
  progressHeading,
  type ProgressStepStatus,
} from "./depositProgressLogic"
import { type DepositSession, recoveryReference, useDepositSessionStore } from "./depositSession"
import { depositApiRpcUrls, findEthereumUsdcRoute } from "./depositSources"
import {
  checkSourceTransaction,
  getPinnedProvider,
  type SourceTxOutcome,
  useSenderNonces,
} from "./evmRpc"
import ProgressSteps from "./ProgressSteps"
import { useTransferForm } from "./transferFlowConfig"
import styles from "./DepositProgress.module.css"

import type { ReactNode } from "react"

const POLL_INTERVAL = 5_000
const RETRY_NOTICE_DELAY = 20_000

// A query whose first read failed drops back to pending on each refetch; the timestamps hold the
// failure until a read succeeds.
const lastReadFailed = (query: { errorUpdatedAt: number; dataUpdatedAt: number }) =>
  query.errorUpdatedAt > query.dataUpdatedAt

const DepositProgress = () => {
  const { watch } = useTransferForm()
  const sessionId = watch("depositSessionId")
  const store = useDepositSessionStore()
  const { closeModal } = useModal()

  const session = useMemo(() => (sessionId ? store.read(sessionId) : null), [store, sessionId])

  if (!session) {
    return (
      <ProgressScreen
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
  const queryClient = useQueryClient()
  const { read, write, isVolatile } = useDepositSessionStore()

  const sourceHash = session.currentSourceHash ?? ""
  const depositId = session.depositId ?? ""
  const isHashlessSend =
    !sourceHash && (session.phase === "send_prompt" || session.phase === "submission_unknown")

  const { promptNonce } = session
  // Once the mined nonce moved past the prompt's, no later read can release the send.
  const noncesQuery = useSenderNonces(
    session.source.chainId,
    isHashlessSend && promptNonce !== undefined ? session.source.sender : "",
    (nonces) =>
      promptNonce !== undefined && nonces && nonces.latest > promptNonce ? false : POLL_INTERVAL,
  )

  const sourceWatchKey = depositQueryKeys.sourceWatch(session.id, sourceHash).queryKey
  const sourceQuery = useQuery({
    // The session id and watched hash identify every other input: the session's immutable intent.
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    queryKey: sourceWatchKey,
    // A replacement scan resumes where the last check stopped instead of restarting at the send.
    queryFn: () => {
      const previous = queryClient.getQueryData<SourceTxOutcome>(sourceWatchKey)
      return checkSourceTransaction(
        getPinnedProvider(session.source.chainId),
        sourceHash,
        session,
        previous?.status === "pending" ? previous.nextBlock : undefined,
      )
    },
    enabled: !!depositApiRpcUrls(session.source.chainId) && !!sourceHash && !depositId,
    // The interval is the retry: an RPC error is an evidence gap, not a reason to give up.
    retry: false,
    staleTime: 0,
    refetchInterval: (query) =>
      !query.state.data || query.state.data.status === "pending" ? POLL_INTERVAL : false,
  })
  const sourceOutcome = sourceQuery.data

  // A repriced replacement is the same intent at a new hash; `originalSourceHash` keeps the first.
  const replacementHash =
    sourceOutcome?.status === "replaced" && sourceOutcome.reason === "repriced"
      ? sourceOutcome.hash
      : ""

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

  const handoff = lifiHandoff?.deposit ?? directHandoff?.deposit

  const depositQuery = useDeposit(depositId, identity)
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
  const ethereumRoute = findEthereumUsdcRoute(
    assetsQuery.data,
    session.destination.chainId,
    session.destination.denom,
  )
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
  const held =
    deposit && ethereumRoute
      ? formatSentenceAmount(fromBaseUnit(deposit.amount, { decimals: ethereumRoute.src_decimals }))
      : undefined

  const inputs: DepositProgressInputs = {
    // The record's own fetch time keeps the first reading fresh before the interval ticks.
    now: Math.max(now, depositQuery.dataUpdatedAt),
    nonces: {
      data: noncesQuery.data,
      readAt: noncesQuery.dataUpdatedAt,
      isError: lastReadFailed(noncesQuery),
    },
    source: { outcome: sourceOutcome, isError: lastReadFailed(sourceQuery) },
    bridge: {
      state: bridgeStatus?.state,
      error: bridgeQuery.error,
      conflict: lifiHandoff?.conflict,
    },
    direct: {
      found: directQuery.isFetched ? !!directRecord : undefined,
      isError: lastReadFailed(directQuery),
      conflict: directHandoff?.conflict,
    },
    deposit: {
      bucket,
      delivery: deposit?.delivery,
      isError: lastReadFailed(depositQuery),
      conflict: depositQuery.error instanceof ParseError,
      minLabel,
      completedAmount,
      heldAmount: held && `${held} USDC`,
    },
  }

  const view = deriveDepositProgress(session, inputs)
  const stageKey = `${view.variant}:${view.persist?.lastState ?? ""}`
  const [delayedStage, setDelayedStage] = useState<string | null>(null)
  useEffect(() => {
    const timer = setTimeout(() => setDelayedStage(stageKey), TAKING_LONGER_DELAY)
    return () => clearTimeout(timer)
  }, [stageKey])
  const heading = progressHeading(view, session, inputs, delayedStage === stageKey)

  // Re-checked against the stored record: another tab may have recorded a hash or a heartbeat since.
  const releaseNotSent = (manual: boolean) => {
    const current = read(session.id)
    if (!current || current.currentSourceHash) return
    if (current.phase !== "send_prompt" && current.phase !== "submission_unknown") return
    const check = checkHashlessSend(current, inputs.nonces, Date.now())
    if (!(manual ? check.canMarkNotSent : check.release)) return
    write({ ...current, phase: "terminal", lastState: "not_sent" })
  }

  const persistProgress = useEffectEvent(() => {
    if (view.persist?.lastState === "not_sent") return releaseNotSent(false)
    const current = read(session.id)
    if (!current) return
    // Seeded so the tracker opens on the handed-off record instead of a blank first poll.
    if (handoff && !current.depositId) {
      queryClient.setQueryData(depositQueryKeys.deposit(handoff.id).queryKey, handoff)
    }
    const learnedNonce = sourceOutcome?.status === "pending" ? sourceOutcome.nonce : undefined
    const patch = {
      ...(replacementHash && { currentSourceHash: replacementHash }),
      ...(learnedNonce !== undefined &&
        current.sourceNonce === undefined && { sourceNonce: learnedNonce }),
      ...(handoff && { depositId: handoff.id }),
      ...view.persist,
    }
    if (!whereEq(patch, current)) write({ ...current, ...patch })
  })
  useEffect(() => {
    persistProgress()
  }, [
    replacementHash,
    sourceOutcome,
    handoff?.id,
    view.persist?.phase,
    view.persist?.lastState,
    // Each nonce read re-checks a pending "not sent" release.
    noncesQuery.dataUpdatedAt,
  ])

  const explorerUrl = resolveExplorerUrl(deposit, bridgeStatus)

  const refresh = () => {
    for (const query of [sourceQuery, bridgeQuery, directQuery, depositQuery]) {
      if (query.isEnabled) void query.refetch()
    }
  }

  const showClose = view.variant !== "in-flight"
  const showRefresh = view.variant === "problem" && !!sourceHash
  const footer =
    showClose || showRefresh ? (
      <Footer>
        {view.canMarkNotSent && (
          <Button.Outline fullWidth onClick={() => releaseNotSent(true)}>
            I didn't send this
          </Button.Outline>
        )}
        {showRefresh && (
          <Button.White fullWidth onClick={refresh}>
            Refresh
          </Button.White>
        )}
        {showClose && (
          <Button.Outline fullWidth onClick={closeModal}>
            Close
          </Button.Outline>
        )}
      </Footer>
    ) : null

  // Past the usual time, reassure that closing doesn't stop the deposit.
  const note = view.note ?? (heading === DELAYED_HEADING ? DELAYED_NOTE : undefined)

  // A read that fails briefly and recovers isn't worth a notice; one that keeps failing is.
  const [retryOverdue, setRetryOverdue] = useState(false)
  useEffect(() => {
    if (!view.isRetrying) return
    const timer = setTimeout(() => setRetryOverdue(true), RETRY_NOTICE_DELAY)
    return () => {
      clearTimeout(timer)
      setRetryOverdue(false)
    }
  }, [view.isRetrying])

  // Storage could not hold this transfer, so the reference is the user's only durable copy.
  const showRecovery = isVolatile(session.id)

  const showChips = view.variant === "in-flight" || view.variant === "completed"

  return (
    <ProgressScreen
      title={view.title}
      variant={view.variant}
      heading={heading}
      message={view.message}
      note={note}
      chips={
        <>
          {showChips && <ProgressChips session={session} />}
          {showRecovery && <RecoveryReference session={session} />}
        </>
      }
      explorerUrl={explorerUrl}
      onHistoryClick={view.variant === "completed" ? () => openDrawer("/activity") : undefined}
      footer={footer}
      isRetrying={!!view.isRetrying && retryOverdue}
      steps={deriveProgressSteps(session, inputs, view)}
    />
  )
}

// A deposit that cannot be proven to be this user's is a tracking conflict, never a completion.
function checkHandoff(assert: () => Deposit): { deposit?: Deposit; conflict?: boolean } {
  try {
    return { deposit: assert() }
  } catch {
    return { conflict: true }
  }
}

function resolveExplorerUrl(
  deposit: Deposit | null,
  bridgeStatus: BridgeStatusResponse | undefined,
): string | undefined {
  const href =
    deposit?.advance_tx_explorer_url ||
    deposit?.bot_tx_explorer_url ||
    bridgeStatus?.dst_tx_link ||
    bridgeStatus?.src_tx_link
  return href ? xss(sanitizeLink(href)) : undefined
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
  return (
    <FlowChips
      steps={[
        {
          label: "You sent",
          logoUrl: `${registryUrl}/images/${source.symbol}.png`,
          chainLogoUrl: source.chainLogoUrl ?? "",
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

interface ProgressScreenProps {
  title: string
  variant: DepositProgressVariant
  heading?: string
  message?: ReactNode
  note?: ReactNode
  chips?: ReactNode
  explorerUrl?: string
  onHistoryClick?: () => void
  footer?: ReactNode
  isRetrying?: boolean
  steps?: ProgressStepStatus[]
}

// Mark, then what happened, then what was moved: one spacing rhythm for every state.
const ProgressScreen = (props: ProgressScreenProps) => {
  const { title, variant, heading, message, note, chips, explorerUrl, onHistoryClick, footer } =
    props
  // A problem needs attention but isn't a verdict on the funds; only a failure reads as one.
  const isError = variant === "failed" || variant === "below-minimum"

  return (
    <DepositSubpage title={title}>
      <div className={styles.screen}>
        <div className={styles.mark}>
          {props.steps ? (
            <ProgressSteps steps={props.steps} />
          ) : variant === "in-flight" ? (
            <Loader size={40} color="var(--success)" />
          ) : variant === "completed" ? (
            <IconCheckCircleFilled size={48} className={trackingStyles.successIcon} aria-hidden />
          ) : variant === "problem" ? (
            <IconWarningFilled size={48} className={trackingStyles.warningIcon} aria-hidden />
          ) : (
            <IconCloseCircleFilled size={48} className={trackingStyles.failIcon} aria-hidden />
          )}
        </div>

        <div className={styles.copy}>
          {heading && <p className={styles.heading}>{heading}</p>}
          {message && (
            <DepositStatus error={isError} className={styles.message}>
              {message}
            </DepositStatus>
          )}
          {note && <DepositStatus className={styles.note}>{note}</DepositStatus>}
          {props.isRetrying && <DepositStatus className={styles.note}>Reconnecting…</DepositStatus>}
        </div>

        {(chips || explorerUrl || onHistoryClick) && (
          <div className={styles.summary}>
            {chips}
            <ExplorerLinks explorerUrl={explorerUrl} onHistoryClick={onHistoryClick} />
          </div>
        )}
      </div>

      {footer}
    </DepositSubpage>
  )
}

export default DepositProgress
