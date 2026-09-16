import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useDebounceValue } from "usehooks-ts"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useConfig } from "@/data/config"
import { normalizeErrorMessage } from "@/data/http"
import { useGetProvider } from "@/data/signer"
import { useLocationState } from "@/lib/router"
import { useFindSkipChain } from "@/pages/bridge/data/chains"
import { switchEthereumChain } from "@/pages/bridge/data/evm"
import { useHexAddress, useInitiaAddress } from "@/public/data/hooks"
import { depositQueryKeys, useDepositApi } from "../data/api"
import { createDepositAssetsQueryOptions } from "../data/assets"
import {
  bridgeQuoteSignature,
  type BridgeRequestIdentity,
  createBridgeOptionsQueryOptions,
  createBridgeQuoteQueryOptions,
  meetsRequiredMinimum,
  rankBridgeOptions,
} from "../data/bridges"
import { useDepositAddress } from "../data/depositAddress"
import { createQuoteQueryOptions } from "../data/quote"
import { formatSourceMin } from "../data/source"
import type { Asset, BridgeQuoteResponse, DestinationNetwork } from "../data/types"
import type { DepositSession } from "./depositSession"
import {
  createDepositSession,
  DepositSessionLockError,
  DepositSessionWriteError,
  holdDepositSessionLock,
  isPhaseAdvance,
  isSameIntent,
  readDepositSession,
  rollbackDepositSessionPrompt,
  useDepositSessionStore,
  writeDepositSession,
} from "./depositSession"
import type { DepositTransportResolution } from "./depositSources"
import {
  ETHEREUM_CHAIN_ID,
  ETHEREUM_USDC_DENOM,
  findDepositApiSource,
  resolveDepositTransport,
  toBaseUnitString,
} from "./depositSources"
import {
  buildDepositTransaction,
  type DepositReadiness,
  deriveDepositReadiness,
  derivePreflight,
  deriveQuoteAcknowledgement,
  directDepositSignature,
  isKnownNotSent,
  isQuoteBoundToOptions,
  isQuoteStale,
  isWalletRejection,
  meetsDirectMinimum,
  type QuoteAcknowledgement,
  requiredNativeAmount,
  resolveDepositRecipient,
  selectBridgeOption,
  sendTransactionHashOf,
} from "./depositTransferLogic"
import {
  encodeErc20Approve,
  readAllowance,
  readBlockNumber,
  readMaxFeePerGas,
  usePinnedSourceBalances,
  useSourceChainProvider,
} from "./evmRpc"
import { useTransferFlow, useTransferForm } from "./transferFlowConfig"
import type { TransferLocationState } from "./transferNavigation"

export type DepositTransfer = Extract<DepositTransportResolution, { transport: "direct" | "lifi" }>

/** The controlled view model the details and footer render directly; no branching left in the view. */
export interface DepositTransferModel {
  transport: "direct" | "lifi"
  route: Asset
  destination: DestinationNetwork
  /** bech32 lowercase, from resolveDepositRecipient. */
  recipient: string
  isHostRecipient: boolean
  /** The bound LI.FI quote whose details are on screen; undefined on the direct path. */
  quote?: BridgeQuoteResponse
  /** Destination base units from the downstream /v1/quote; the gate itself lives in `readiness`. */
  estimatedAmountOut?: string
  approval: {
    required: boolean
    isChecking: boolean
    isApproving: boolean
    error?: string
    approve?: () => void
  }
  readiness: DepositReadiness
  submit: () => void
  isSubmitting: boolean
  submitError?: string
  nativeSymbol: string
  /** Chains the funds pass through, in order, for the route row. */
  legs: { name: string; logoUrl: string }[]
  /** The reviewed quote changed under a refresh; a fresh deliberate click is required. */
  quoteUpdated: boolean
  /** A click landed on a stale or refreshing quote: it is being re-read, and the next click sends. */
  isRefreshingQuote: boolean
  /** A wallet call returned no hash: the form is locked and the only action is to watch the session. */
  unknownSend: boolean
  openProgress: () => void
  openRouteSelection?: () => void
}

// Lower bound for replacement detection: must be recent, need not be per-render fresh.
const SOURCE_BLOCK_REFRESH_MS = 15_000
// One retry for a lock that this tab's previous mount is still handing back.
const LOCK_RETRY_MS = 300
// Past this the receipt watch is handed to the progress view rather than blocking the form.
const APPROVAL_RECEIPT_TIMEOUT_MS = 120_000

// Non-suspense by design: mounting the suspense-only assets hooks would let a Deposit API
// outage suspend the whole transfer form, including Router pairs unrelated to it.
export function useDepositTransportResolution() {
  const { mode } = useTransferFlow()
  const { depositApiUrl } = useConfig()
  const api = useDepositApi()
  const { watch } = useTransferForm()
  const { srcChainId, srcDenom, dstChainId, dstDenom } = watch()
  const hasDepositApi = !!depositApiUrl

  const catalogQuery = useQuery({
    ...createDepositAssetsQueryOptions(api),
    enabled: hasDepositApi && mode === "deposit",
  })
  const { data: catalog, error: catalogError, refetch, isFetching } = catalogQuery

  const resolution = useMemo(
    () =>
      resolveDepositTransport({
        mode,
        hasDepositApi,
        srcChainId,
        srcDenom,
        dstChainId,
        dstDenom,
        catalog,
        catalogError: !!catalogError,
      }),
    [mode, hasDepositApi, srcChainId, srcDenom, dstChainId, dstDenom, catalog, catalogError],
  )

  return { resolution, retryCatalog: refetch, isCatalogFetching: isFetching }
}

export interface DepositRequestState {
  identity: BridgeRequestIdentity
  /** bech32 lowercase. */
  recipient: string
  isHostRecipient: boolean
  recipientError?: string
  /** Source base units; "" when the typed quantity is not representable. */
  amount: string
  /** Every field the bridge request is bound to is present. */
  isComplete: boolean
}

// Exported so SelectDepositRoute assembles the same request key and reads the options the form
// already fetched; a second request could rank differently than the footer is gating on.
export function useDepositRequest(resolution: DepositTransportResolution): DepositRequestState {
  const { watch } = useTransferForm()
  const { quantity = "" } = watch()
  const { recipientAddress } = useLocationState<TransferLocationState>()
  const initiaAddress = useInitiaAddress()
  const hexAddress = useHexAddress()

  // Same 300 ms window as the Router route query: otherwise options and quotes are POSTs per keystroke.
  const [debouncedQuantity] = useDebounceValue(quantity, 300)

  const resolved = resolveDepositRecipient(recipientAddress, initiaAddress)
  const recipient = "recipient" in resolved ? resolved.recipient : ""
  const recipientError = "error" in resolved ? resolved.error : undefined

  const isTransfer = resolution.transport === "direct" || resolution.transport === "lifi"
  const source = isTransfer ? resolution.source : undefined
  const destination = isTransfer ? resolution.destination : undefined
  const amount = source ? toBaseUnitString(debouncedQuantity, source.decimals) : ""

  const identity: BridgeRequestIdentity = {
    srcChainId: source?.chainId ?? "",
    srcDenom: source?.denom ?? "",
    dstChainId: destination?.chain_id ?? "",
    dstDenom: destination?.denom ?? "",
    amount,
    fromAddress: hexAddress,
    walletAddress: recipient,
  }

  return {
    identity,
    recipient,
    isHostRecipient: !!recipientAddress,
    recipientError,
    amount,
    isComplete:
      !!source && !!destination && !!amount && !!hexAddress && !!recipient && !recipientError,
  }
}

// Ordering is the point of this hook: the session is written and read back before any prompt,
// the per-session Web Lock is taken while the form is merely ready (so the click path holds no
// await but the wallet calls — see the Safari popup rule in AGENTS.md), and the returned hash is
// persisted before anything navigates. A failure after the prompt is never treated as "not sent".
export function useDepositTransfer(resolution: DepositTransfer): DepositTransferModel {
  const { transport, source, route, destination } = resolution
  const api = useDepositApi()
  const { depositApiUrl = "" } = useConfig()
  const queryClient = useQueryClient()
  const getProvider = useGetProvider()
  const findSkipChain = useFindSkipChain()
  const { setValue, watch } = useTransferForm()
  const { selectedBridge: selectedBridgeKey = "", depositSessionId = "", quantity = "" } = watch()
  const hexAddress = useHexAddress()
  const request = useDepositRequest(resolution)
  const { identity, recipient, recipientError, amount } = request

  const [submitError, setSubmitError] = useState<string | undefined>(undefined)
  const [approvalError, setApprovalError] = useState<string | undefined>(undefined)
  const [lockError, setLockError] = useState<string | undefined>(undefined)
  const [storageBlocked, setStorageBlocked] = useState(false)
  const [unknownSend, setUnknownSend] = useState(false)
  const [acknowledgement, setAcknowledgement] = useState<QuoteAcknowledgement | null>(null)
  // Compared against the query's own timestamp, so it clears by itself once a newer read lands.
  const [refreshRequestedAt, setRefreshRequestedAt] = useState(0)

  // --- Source-chain-pinned reads: the single authority for this pair ---------
  const balancesQuery = usePinnedSourceBalances({
    chainId: source.chainId,
    owner: hexAddress,
    token: source.denom,
    enabled: !!hexAddress,
  })
  const pinnedProvider = useSourceChainProvider(source.chainId)

  const blockQuery = useQuery({
    // eslint-disable-next-line @tanstack/query/exhaustive-deps -- the provider is derived from chainId, already in the key
    queryKey: depositQueryKeys.sourceBlock(source.chainId).queryKey,
    queryFn: () => readBlockNumber(pinnedProvider!),
    enabled: !!pinnedProvider,
    staleTime: SOURCE_BLOCK_REFRESH_MS,
    refetchInterval: SOURCE_BLOCK_REFRESH_MS,
  })

  // Priced gas for the fee gate; a missing read only narrows the gate to the call's own native value.
  const feeQuery = useQuery({
    // eslint-disable-next-line @tanstack/query/exhaustive-deps -- the provider is derived from chainId, already in the key
    queryKey: depositQueryKeys.maxFeePerGas(source.chainId).queryKey,
    queryFn: () => readMaxFeePerGas(pinnedProvider!),
    enabled: !!pinnedProvider,
    staleTime: SOURCE_BLOCK_REFRESH_MS,
    refetchInterval: SOURCE_BLOCK_REFRESH_MS,
  })

  // --- Bridge options and quote (LI.FI only) --------------------------------
  const optionsEnabled = transport === "lifi" && request.isComplete
  const optionsQuery = useQuery(createBridgeOptionsQueryOptions(api, identity, optionsEnabled))
  const optionsData = optionsEnabled ? optionsQuery.data : undefined
  const ranked = useMemo(
    () => rankBridgeOptions(optionsData?.options ?? []),
    // rankBridgeOptions copies its input, so the parsed array is the identity.
    [optionsData],
  )
  const { option: selectedBridge, clearSelection } = selectBridgeOption(ranked, selectedBridgeKey)

  useEffect(() => {
    // The user's pick is no longer executable; the ranked default takes over.
    if (clearSelection) setValue("selectedBridge", "")
  }, [clearSelection, setValue])

  const quoteQueryOptions = createBridgeQuoteQueryOptions(
    api,
    {
      ...identity,
      bridge: selectedBridge?.bridge ?? "",
      sourceToken: source.denom,
      depositAddress: optionsData?.deposit_address,
    },
    optionsEnabled && !!selectedBridge,
  )
  const quoteQuery = useQuery(quoteQueryOptions)
  const quote = transport === "lifi" ? quoteQuery.data : undefined
  // The options response echoes nothing back, so the issued address is the only shared identity with the ranked list.
  const quoteBound =
    transport === "direct" ||
    isQuoteBoundToOptions(quote?.deposit_address, optionsData?.deposit_address)
  // A quote issued for a newer address than the options: re-read the options once per pair
  // so the quote key above follows, instead of leaving the form blocked on a stale list.
  const unboundPair =
    quote && optionsData && !quoteBound
      ? `${quote.deposit_address}|${optionsData.deposit_address}`
      : ""
  const refetchOptions = optionsQuery.refetch
  useEffect(() => {
    if (unboundPair) void refetchOptions()
  }, [unboundPair, refetchOptions])
  // The only quote the rest of this hook may read: an unbound one describes a different backend state.
  const boundQuote = quote && quoteBound ? quote : undefined

  // --- Issued address (direct) ----------------------------------------------
  const depositAddressQuery = useDepositAddress({
    // Empty walletAddress keeps the query disabled on the LI.FI path, where the address comes from the quote.
    walletAddress: transport === "direct" ? recipient : "",
    chainId: destination.chain_id,
    assetDenom: destination.denom,
  })
  const issuedAddress = transport === "direct" ? depositAddressQuery.data : boundQuote
  const depositAddress = issuedAddress?.deposit_address
  const cursor = issuedAddress?.cursor ?? ""

  // --- Minimums -------------------------------------------------------------
  const meetsMinimum =
    transport === "lifi"
      ? !!boundQuote &&
        !!optionsData &&
        meetsRequiredMinimum(
          boundQuote,
          optionsData.required_min_received,
          route.min_deposit_amount,
        )
      : meetsDirectMinimum(amount, route.min_deposit_amount)
  const minimumLabel = formatSourceMin(route.min_deposit_amount, route.src_decimals, "USDC")

  // --- Downstream preflight + displayed estimate ----------------------------
  const quoteBase = {
    srcChainId: ETHEREUM_CHAIN_ID,
    srcDenom: ETHEREUM_USDC_DENOM,
    dstChainId: destination.chain_id,
    dstDenom: destination.denom,
  }
  // Worst case: quoting the expected output instead would clear a gate the guaranteed amount fails.
  const preflightAmount = transport === "lifi" ? (boundQuote?.min_received ?? "") : amount
  const displayAmount = transport === "lifi" ? (boundQuote?.amount_out ?? "") : amount
  const preflightQuery = useQuery(
    createQuoteQueryOptions(
      api,
      { ...quoteBase, amountIn: preflightAmount },
      !!depositApiUrl && !!preflightAmount,
    ),
  )
  // An equal display amount already shares the preflight's cache entry; disabling the observer avoids a duplicate fetch.
  const needsDisplayQuote = !!displayAmount && displayAmount !== preflightAmount
  const displayQuery = useQuery(
    createQuoteQueryOptions(
      api,
      { ...quoteBase, amountIn: displayAmount },
      !!depositApiUrl && needsDisplayQuote,
    ),
  )

  const preflight = derivePreflight({
    amountIn: preflightAmount,
    hasError: !!preflightQuery.error,
    result: preflightQuery.data,
    isPlaceholderData: preflightQuery.isPlaceholderData,
  })
  const displaySource = needsDisplayQuote ? displayQuery : preflightQuery
  const displayResult =
    displaySource.data && !displaySource.isPlaceholderData ? displaySource.data : undefined
  const displayQuote = displayResult?.status === "quoted" ? displayResult.quote : undefined

  // --- Allowance (LI.FI only) -----------------------------------------------
  const approval = boundQuote?.approval ?? null
  const spender = approval?.spender_address ?? ""
  const allowanceKey = depositQueryKeys.allowance(
    source.chainId,
    hexAddress,
    source.denom,
    spender,
  ).queryKey
  const allowanceQuery = useQuery({
    // eslint-disable-next-line @tanstack/query/exhaustive-deps -- the provider is derived from chainId, already in the key
    queryKey: allowanceKey,
    queryFn: () =>
      readAllowance(pinnedProvider!, { owner: hexAddress, token: source.denom, spender }),
    enabled: !!pinnedProvider && !!hexAddress && !!approval,
    staleTime: SOURCE_BLOCK_REFRESH_MS,
  })
  const approvalRequired =
    !!approval &&
    allowanceQuery.data !== undefined &&
    BigInt(allowanceQuery.data) < BigInt(approval.amount)
  const approvalChecking = !!approval && allowanceQuery.data === undefined && !allowanceQuery.error
  // An unreadable allowance is not "no approval needed": sending without one reverts after the user pays gas.
  const allowanceError =
    approval && allowanceQuery.error ? "Could not check the USDC allowance" : undefined
  // The unreadable-allowance error outranks a failed attempt, because it blocks the send outright.
  const approvalMessage = allowanceError ?? approvalError

  // --- Freshness and review gate --------------------------------------------
  // Each path ages against the read the user actually reviewed.
  const freshnessQuery = transport === "lifi" ? quoteQuery : preflightQuery
  const freshnessUpdatedAt = freshnessQuery.dataUpdatedAt
  // A failed re-read must surface its error rather than leave the button spinning, so settle on either result.
  const freshnessSettledAt = Math.max(freshnessQuery.dataUpdatedAt, freshnessQuery.errorUpdatedAt)
  const isRefreshing = transport === "lifi" ? quoteQuery.isFetching : preflightQuery.isFetching
  const signature =
    transport === "lifi"
      ? boundQuote
        ? bridgeQuoteSignature(boundQuote)
        : ""
      : directDepositSignature({
          depositAddress: depositAddress ?? "",
          amount,
          recipient,
          dstChainId: destination.chain_id,
          dstDenom: destination.denom,
        })
  const identityKey = [
    source.chainId,
    source.denom,
    amount,
    recipient,
    selectedBridge?.bridge ?? "",
  ].join(":")

  // Captured now so the progress screen renders a saved session without a registry or Router read.
  const lookupChain = (chainId: string) => {
    try {
      return findSkipChain(chainId)
    } catch {
      return undefined
    }
  }
  const sourceChain = lookupChain(source.chainId)
  const destinationChain = lookupChain(destination.chain_id)
  const ethereumChain = lookupChain(ETHEREUM_CHAIN_ID)
  const ethereumLeg = {
    name: "Ethereum",
    logoUrl:
      ethereumChain?.logo_uri ||
      findDepositApiSource(ETHEREUM_CHAIN_ID, ETHEREUM_USDC_DENOM)?.fallbackChainLogoUrl ||
      "",
  }
  const legs = [
    ...(transport === "lifi"
      ? [{ name: source.chainName, logoUrl: sourceChain?.logo_uri || source.fallbackChainLogoUrl }]
      : []),
    ethereumLeg,
    {
      name: destinationChain?.pretty_name || destination.chain_name,
      logoUrl: destinationChain?.logo_uri ?? "",
    },
  ]

  const sessionDraft = useMemo((): DepositSessionDraft | undefined => {
    if (!recipient || !hexAddress || !amount || !depositAddress || !cursor) return undefined
    const transaction =
      transport === "lifi"
        ? boundQuote && buildDepositTransaction({ transport: "lifi", quote: boundQuote })
        : buildDepositTransaction({ transport: "direct", depositAddress, amount })
    if (!transaction) return undefined

    return {
      apiUrl: depositApiUrl,
      transport,
      source: {
        chainId: source.chainId,
        denom: source.denom,
        decimals: source.decimals,
        sender: hexAddress,
        amount,
        symbol: source.symbol,
        chainName: source.chainName,
        chainLogoUrl: sourceChain?.logo_uri || source.fallbackChainLogoUrl,
      },
      destination: {
        chainId: destination.chain_id,
        denom: destination.denom,
        recipient,
        symbol: route.dst_symbol,
        chainName: destinationChain?.pretty_name || destination.chain_name,
        chainLogoUrl: destinationChain?.logo_uri ?? "",
      },
      depositAddress,
      cursor,
      ...(boundQuote
        ? {
            bridge: {
              tool: boundQuote.tool,
              ...(boundQuote.quote_id ? { quoteId: boundQuote.quote_id } : {}),
              minReceived: boundQuote.min_received,
              amountOut: boundQuote.amount_out,
            },
          }
        : {}),
      transaction,
    }
  }, [
    amount,
    boundQuote,
    cursor,
    depositAddress,
    depositApiUrl,
    destination,
    hexAddress,
    recipient,
    route.dst_symbol,
    source,
    sourceChain,
    destinationChain,
    transport,
  ])

  const nativeSymbol = sourceChain?.evm_fee_asset?.symbol || "ETH"
  // A record that already reached the send prompt on another mount must not be re-signed here.
  const store = useDepositSessionStore()
  const storedSession = depositSessionId ? store.read(depositSessionId) : undefined
  const sessionInFlight =
    !!storedSession &&
    storedSession.phase !== "terminal" &&
    isPhaseAdvance("send_prompt", storedSession.phase)

  const readiness = deriveDepositReadiness({
    transport,
    unknownSend,
    sessionInFlight,
    storageBlocked,
    lockError,
    recipientError,
    quantityEntered: !!quantity,
    isAmountSettled: toBaseUnitString(quantity, source.decimals) === amount,
    amount,
    balancesError: !!balancesQuery.error,
    tokenBalance: balancesQuery.data?.token,
    nativeBalance: balancesQuery.data?.native,
    nativeSymbol,
    requiredNative: requiredNativeAmount({
      value: sessionDraft?.transaction.value,
      gasLimit: sessionDraft?.transaction.gasLimit,
      maxFeePerGas: feeQuery.data,
    }),
    optionsError: optionsQuery.error?.message,
    hasOptions: !!optionsData,
    hasEligibleOption: !!selectedBridge,
    quoteError: quoteQuery.error?.message,
    hasQuote: !!quote,
    quoteBound,
    isRefreshing: optionsQuery.isFetching || quoteQuery.isFetching,
    meetsMinimum,
    minimumLabel,
    approvalChecking,
    approvalError: approvalMessage,
    depositAddressError: depositAddressQuery.error?.message,
    hasDepositAddress: !!depositAddress,
    preflight: preflight.status,
    preflightReason: preflight.reason,
    hasPreSubmitBlock: blockQuery.data !== undefined,
    pinnedRpcAvailable: !!pinnedProvider,
  })

  const { next: nextAcknowledgement, quoteUpdated } = deriveQuoteAcknowledgement({
    acknowledgement,
    identityKey,
    signature,
    isReviewable: readiness.status === "ready",
  })
  useEffect(() => {
    if (nextAcknowledgement !== acknowledgement) setAcknowledgement(nextAcknowledgement)
  }, [nextAcknowledgement, acknowledgement])

  // --- Session identity -----------------------------------------------------
  // The facts a session may never change (see assertSameIntent): a different intent gets its own record and lock.
  const intentKey = [
    depositApiUrl,
    transport,
    source.chainId,
    source.denom,
    hexAddress,
    destination.chain_id,
    destination.denom,
    recipient,
  ].join("|")

  const sessionRef = useRef<{ intentKey: string; session: DepositSession } | null>(null)
  useEffect(() => {
    if (!sessionDraft) return
    if (sessionRef.current?.intentKey === intentKey) return
    // The id lives in the form so a wallet rejection, or a remount (the provider picker, a
    // source change and back), reuses the same record while it is still re-signable.
    const stored = depositSessionId ? readDepositSession(localStorage, depositSessionId) : null
    const reusable =
      !!stored && isSameIntent(stored, sessionDraft) && !isPhaseAdvance("send_prompt", stored.phase)
    const session = reusable ? stored : createDepositSession(sessionDraft)
    sessionRef.current = { intentKey, session }
    if (session.id !== depositSessionId) setValue("depositSessionId", session.id)
  }, [sessionDraft, intentKey, setValue, depositSessionId])

  // --- Per-session Web Lock -------------------------------------------------
  // Taken well before the click, so the click path holds no await other than the wallet calls.
  const lockRef = useRef<{ release: () => void } | null>(null)
  useEffect(() => {
    if (!depositSessionId) return
    let cancelled = false
    // The previous mount releases the same lock in its cleanup and the browser hands it back a
    // tick later; one short retry keeps that hand-off from reading as another tab.
    const acquire = (attempt: number): Promise<{ release: () => void }> =>
      holdDepositSessionLock(depositSessionId).catch((error: unknown) => {
        if (attempt > 0 || cancelled || !(error instanceof DepositSessionLockError)) throw error
        return new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS)).then(() => acquire(1))
      })
    acquire(0)
      .then((handle) => {
        if (cancelled) {
          handle.release()
          return
        }
        lockRef.current = handle
        setLockError(undefined)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        // Fail closed: without exclusion two tabs could each open a prompt for the same session.
        setLockError(
          error instanceof DepositSessionLockError
            ? error.message
            : "This deposit could not be locked for sending.",
        )
      })
    return () => {
      cancelled = true
      lockRef.current?.release()
      lockRef.current = null
    }
  }, [depositSessionId])

  // --- Persistence ----------------------------------------------------------
  const persist = useCallback((session: DepositSession): DepositSession => {
    // Read-back is inside writeDepositSession; a non-durable record of an intended transfer blocks signing.
    return writeDepositSession(localStorage, session)
  }, [])

  const composeSession = useCallback(
    (phase: DepositSession["phase"], extra: Partial<DepositSession> = {}): DepositSession => {
      const current = sessionRef.current?.session
      if (!current || !sessionDraft) throw new Error("This deposit is not ready to send")
      return {
        ...current,
        ...sessionDraft,
        phase,
        updatedAt: Date.now(),
        ...(blockQuery.data !== undefined ? { preSubmitBlock: blockQuery.data } : {}),
        ...extra,
      }
    },
    [blockQuery.data, sessionDraft],
  )

  /** Compose and durably record one phase, returning what was written. Throws when the write is not durable. */
  const persistPhase = useCallback(
    (phase: DepositSession["phase"], extra?: Partial<DepositSession>): DepositSession => {
      const session = composeSession(phase, extra)
      persist(session)
      return session
    },
    [composeSession, persist],
  )

  // --- Approval -------------------------------------------------------------
  const approveMutation = useMutation({
    mutationFn: async () => {
      if (!approval) throw new Error("No approval is required")
      if (!pinnedProvider) throw new Error("This source chain cannot be verified right now")
      const approvalRecord = { spender: approval.spender_address, amount: approval.amount }

      persistPhase("approval_prompt", { approval: approvalRecord })

      const provider = await getProvider()
      const signer = await provider.getSigner()
      await switchEthereumChain(provider, findSkipChain(source.chainId))
      const response = await signer.sendTransaction({
        chainId: Number(source.chainId),
        to: approval.token_address,
        data: encodeErc20Approve(approval.spender_address, approval.amount),
      })

      persistPhase("approval_sent", { approval: { ...approvalRecord, hash: response.hash } })
      await pinnedProvider.waitForTransaction(response.hash, 1, APPROVAL_RECEIPT_TIMEOUT_MS)
      persistPhase("approval_sent", {
        approval: { ...approvalRecord, hash: response.hash, confirmed: true },
      })
    },
    onMutate: () => {
      setApprovalError(undefined)
    },
    onSuccess: () => {
      // A fresh quote may carry a different spender or amount; the allowance read must not answer from cache.
      void queryClient.invalidateQueries({ queryKey: quoteQueryOptions.queryKey })
      void queryClient.invalidateQueries({ queryKey: allowanceKey })
    },
    onError: async (error: unknown) => {
      if (error instanceof DepositSessionWriteError) {
        setStorageBlocked(true)
        return
      }
      const message = await normalizeErrorMessage(error)
      const sessionId = sessionRef.current?.session.id
      if (isWalletRejection(message) && sessionId) {
        rollbackDepositSessionPrompt(localStorage, sessionId)
      }
      setApprovalError(message)
    },
  })

  // --- Send -----------------------------------------------------------------
  const sendMutation = useMutation({
    mutationFn: async () => {
      // Written and read back *before* the prompt: an in-flight transfer must never go undescribed.
      const prepared = persistPhase("prepared")

      const provider = await getProvider()
      const signer = await provider.getSigner()
      await switchEthereumChain(provider, findSkipChain(prepared.transaction.chainId))

      // Immediately before the wallet call, so a tab that disappears mid-prompt leaves evidence of a possible send.
      persistPhase("send_prompt")

      let response: { hash: string; nonce?: number; from: string }
      try {
        const { transaction } = prepared
        response = await signer.sendTransaction({
          chainId: Number(transaction.chainId),
          to: transaction.to,
          data: transaction.data,
          value: BigInt(transaction.value),
          ...(transaction.gasLimit ? { gasLimit: BigInt(transaction.gasLimit) } : {}),
        })
      } catch (error) {
        const message = await normalizeErrorMessage(error)
        // A rejected prompt or a node refusal before the mempool are the only failures that provably did not send.
        if (isWalletRejection(message) || isKnownNotSent(message)) {
          rollbackDepositSessionPrompt(localStorage, prepared.id)
          throw new NotSentError(message)
        }
        // ethers takes the hash from eth_sendTransaction and then reads the transaction back;
        // when that read fails it rejects with the hash attached. The transfer is on chain.
        const sentHash = sendTransactionHashOf(error)
        if (!sentHash) {
          // No hash came back, so nothing here proves the transfer was not broadcast.
          throw new UnknownSendError(message)
        }
        response = { hash: sentHash, from: hexAddress }
      }

      const sent = composeSession("source_sent", {
        submitted: { hash: response.hash, nonce: response.nonce, from: response.from },
        currentSourceHash: response.hash,
        originalSourceHash: response.hash,
      })
      try {
        persist(sent)
      } catch {
        // The broadcast already happened; losing the write must not lose the transfer. The
        // in-memory copy travels with the navigation and the progress view keeps it in memory.
      }

      // The source hash is recorded (or carried in memory): the exclusive claim has done its job.
      lockRef.current?.release()
      lockRef.current = null
      return { session: sent }
    },
    onMutate: () => {
      setSubmitError(undefined)
    },
    onSuccess: ({ session }) => {
      setValue("depositSessionFallback", session)
      setValue("depositSessionId", session.id)
      setValue("page", "deposit-progress")
    },
    onError: async (error: unknown) => {
      if (error instanceof UnknownSendError) {
        setUnknownSend(true)
        const session = composeSession("submission_unknown", {
          failure: { code: "unknown_send", message: error.message },
        })
        setValue("depositSessionFallback", session)
        try {
          persist(session)
        } catch {
          // Already unrecoverable for storage; the locked form and recovery reference are what the user acts on.
          setStorageBlocked(true)
        }
        return
      }
      if (error instanceof NotSentError) {
        setSubmitError(error.message)
        return
      }
      if (error instanceof DepositSessionWriteError) {
        setStorageBlocked(true)
        return
      }
      setSubmitError(await normalizeErrorMessage(error))
    },
  })

  const { refetch: refetchQuote } = quoteQuery
  const { refetch: refetchPreflight } = preflightQuery
  const { refetch: refetchDepositAddress } = depositAddressQuery
  const refetchFreshness = useCallback(() => {
    // refetch() ignores `enabled`, so re-read the address query only on the path that owns it.
    if (transport === "lifi") void refetchQuote()
    else {
      void refetchPreflight()
      void refetchDepositAddress()
    }
  }, [transport, refetchQuote, refetchPreflight, refetchDepositAddress])

  const { mutate: send, isPending: isSending } = sendMutation
  const { mutate: startApproval, isPending: isApproving } = approveMutation

  const submit = useCallback(() => {
    if (isSending || isApproving) return
    if (readiness.status !== "ready") return
    if (isQuoteStale(freshnessUpdatedAt, Date.now()) || isRefreshing) {
      // Never an awaited network refresh between the click and the wallet popup; require another click.
      setRefreshRequestedAt(Date.now())
      refetchFreshness()
      return
    }
    // A click on a fresh quote signs exactly what is on screen; the changed-quote notice has been
    // showing since the refresh, so this click is the deliberate confirmation of the new numbers.
    setAcknowledgement({ identityKey, signature })
    send()
  }, [
    isApproving,
    isSending,
    freshnessUpdatedAt,
    identityKey,
    isRefreshing,
    readiness.status,
    refetchFreshness,
    send,
    signature,
  ])

  const approve = useCallback(() => {
    if (isApproving || isSending) return
    startApproval()
  }, [isApproving, isSending, startApproval])

  return {
    transport,
    route,
    destination,
    recipient,
    isHostRecipient: request.isHostRecipient,
    quote,
    estimatedAmountOut: displayQuote?.amount_out,
    approval: {
      required: approvalRequired,
      isChecking: approvalChecking,
      isApproving,
      error: approvalMessage,
      approve: approvalRequired ? approve : undefined,
    },
    readiness,
    submit,
    isSubmitting: isSending,
    // The unrecoverable storage case is already a readiness blocker; this is a retryable attempt.
    submitError,
    nativeSymbol,
    legs,
    quoteUpdated,
    isRefreshingQuote: refreshRequestedAt > 0 && freshnessSettledAt <= refreshRequestedAt,
    unknownSend: unknownSend || sessionInFlight,
    openProgress: () => setValue("page", "deposit-progress"),
    openRouteSelection: transport === "lifi" ? () => setValue("page", "select-route") : undefined,
  }
}

/** Marker for a send that provably never started (rejected prompt, node refusal): the session rolls back to `prepared` and the form reopens. */
class NotSentError extends Error {}

/** Marker for a wallet call that returned no hash. The form locks and never re-enables send. */
class UnknownSendError extends Error {}

type DepositSessionDraft = Omit<
  DepositSession,
  "version" | "id" | "createdAt" | "updatedAt" | "phase"
>
