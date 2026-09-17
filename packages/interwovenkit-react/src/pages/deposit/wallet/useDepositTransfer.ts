import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useDebounceValue } from "usehooks-ts"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useConfig } from "@/data/config"
import { normalizeErrorMessage } from "@/data/http"
import { useGetProvider } from "@/data/signer"
import { toBaseUnitString } from "@/lib/amountValidation"
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
import type { DepositIntent, DepositSession } from "./depositSession"
import {
  createDepositSession,
  DepositSessionWriteError,
  findInFlightSession,
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
} from "./depositSources"
import {
  buildDepositTransaction,
  decideRefreshedQuote,
  type DepositReadiness,
  deriveDepositReadiness,
  derivePreflight,
  isKnownNotSent,
  isQuoteBoundToOptions,
  isQuoteStale,
  isWalletRejection,
  meetsDirectMinimum,
  requiredNativeAmount,
  resolveDepositRecipient,
  selectBridgeOption,
  sendTransactionHashOf,
} from "./depositTransferLogic"
import {
  encodeErc20Approve,
  readAllowance,
  readMaxFeePerGas,
  usePinnedSourceBalances,
  useSourceChainProvider,
} from "./evmRpc"
import { useTransferFlow, useTransferForm } from "./transferFlowConfig"
import type { TransferLocationState } from "./transferNavigation"

/** The two resolutions the Deposit API executes itself; Router and `unavailable` never reach this hook. */
export type DepositTransportSelection = Extract<
  DepositTransportResolution,
  { transport: "direct" | "lifi" }
>

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
  /** The click's own re-read produced a materially different quote; the next click sends it. */
  quoteUpdated: boolean
  /** A wallet call returned no hash: the form is locked and the only action is to watch the session. */
  unknownSend: boolean
  openProgress: () => void
  openRouteSelection?: () => void
}

// Gas price and allowance: must be recent, need not be per-render fresh.
const SOURCE_READ_REFRESH_MS = 15_000
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

interface DepositRequestState {
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
// and the returned hash is persisted before anything navigates. A failure after the prompt is
// never treated as "not sent".
export function useDepositTransfer(resolution: DepositTransportSelection): DepositTransferModel {
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
  const [storageBlocked, setStorageBlocked] = useState(false)
  const [unknownSend, setUnknownSend] = useState(false)
  // The signature a click's own re-read produced when it differed from the reviewed one. Held
  // as the signature rather than a boolean so the notice clears itself once the quote moves on,
  // without an effect comparing it back to the query.
  const [reviewRequiredSignature, setReviewRequiredSignature] = useState("")
  // The awaited re-read inside a click: re-entrancy guard and the button's pending state.
  const [isRefreshingQuote, setIsRefreshingQuote] = useState(false)

  // --- Source-chain-pinned reads: the single authority for this pair ---------
  const balancesQuery = usePinnedSourceBalances({
    chainId: source.chainId,
    owner: hexAddress,
    token: source.denom,
    enabled: !!hexAddress,
  })
  const pinnedProvider = useSourceChainProvider(source.chainId)

  // The lower bound for ethers' replacement scan, kept warm so nothing but the wallet call sits
  // between the send prompt and the click (Safari drops user activation across a real await).
  const blockQuery = useQuery({
    queryKey: depositQueryKeys.sourceBlock(source.chainId).queryKey,
    queryFn: () => pinnedProvider.getBlockNumber(),
    staleTime: SOURCE_READ_REFRESH_MS,
    refetchInterval: SOURCE_READ_REFRESH_MS,
  })

  // Priced gas for the fee gate; a missing read only narrows the gate to the call's own native value.
  const feeQuery = useQuery({
    // eslint-disable-next-line @tanstack/query/exhaustive-deps -- the provider is derived from chainId, already in the key
    queryKey: depositQueryKeys.maxFeePerGas(source.chainId).queryKey,
    queryFn: () => readMaxFeePerGas(pinnedProvider),
    staleTime: SOURCE_READ_REFRESH_MS,
    refetchInterval: SOURCE_READ_REFRESH_MS,
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
      readAllowance(pinnedProvider, { owner: hexAddress, token: source.denom, spender }),
    enabled: !!hexAddress && !!approval,
    staleTime: SOURCE_READ_REFRESH_MS,
  })
  const approvalRequired =
    !!approval &&
    allowanceQuery.data !== undefined &&
    BigInt(allowanceQuery.data) < BigInt(approval.amount)
  const approvalChecking = !!approval && allowanceQuery.data === undefined && !allowanceQuery.error
  // An unreadable allowance is not "no approval needed": sending without one reverts after the user pays gas.
  const allowanceError =
    approval && allowanceQuery.error ? "Could not check the USDC allowance" : undefined

  // --- Freshness (LI.FI only) -----------------------------------------------
  // Only the LI.FI quote is signed material that ages; the direct path's call is built from the
  // issued address and the typed amount, and its preflight is information about the destination.
  const quoteSignature = boundQuote ? bridgeQuoteSignature(boundQuote) : ""
  const quoteUpdated = !!reviewRequiredSignature && reviewRequiredSignature === quoteSignature

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

  // Parameterized by the quote so the send can build from the quote it just re-read, not
  // from whatever render committed before the click's awaited refresh.
  const buildDraft = useCallback(
    (quote: BridgeQuoteResponse | undefined): DepositSessionDraft | undefined => {
      const issued = transport === "direct" ? depositAddressQuery.data : quote
      const depositAddress = issued?.deposit_address
      const cursor = issued?.cursor ?? ""
      if (!recipient || !hexAddress || !amount || !depositAddress || !cursor) return undefined
      const transaction =
        transport === "lifi"
          ? quote && buildDepositTransaction({ transport: "lifi", quote })
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
        transaction,
      }
    },
    [
      amount,
      depositAddressQuery.data,
      depositApiUrl,
      destination,
      hexAddress,
      recipient,
      route.dst_symbol,
      source,
      sourceChain,
      destinationChain,
      transport,
    ],
  )
  const sessionDraft = useMemo(() => buildDraft(boundQuote), [buildDraft, boundQuote])

  const nativeSymbol = sourceChain?.evm_fee_asset?.symbol || "ETH"

  // A record for this same transfer whose prompt is open or whose send is ambiguous, on any
  // mount (a remount, a closed and reopened widget, another tab), must not be signed again here.
  const store = useDepositSessionStore()
  const intent = useMemo(
    (): DepositIntent => ({
      apiUrl: depositApiUrl,
      transport,
      source: { chainId: source.chainId, denom: source.denom, sender: hexAddress },
      destination: { chainId: destination.chain_id, denom: destination.denom, recipient },
    }),
    [depositApiUrl, transport, source.chainId, source.denom, hexAddress, destination, recipient],
  )
  const inFlightSession = useMemo(
    () =>
      hexAddress && recipient ? findInFlightSession(store.list(depositApiUrl), intent) : undefined,
    [store, depositApiUrl, intent, hexAddress, recipient],
  )
  const sessionInFlight = !!inFlightSession

  const readiness = deriveDepositReadiness({
    transport,
    unknownSend,
    sessionInFlight,
    storageBlocked,
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
    approvalError: allowanceError,
    depositAddressError: depositAddressQuery.error?.message,
    hasDepositAddress: !!depositAddress,
    preflight: preflight.status,
    preflightReason: preflight.reason,
  })

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
    if (sessionRef.current?.intentKey === intentKey) return
    // An in-flight record is adopted so "View progress" opens it; readiness blocks the send.
    if (inFlightSession) {
      sessionRef.current = { intentKey, session: inFlightSession }
      if (inFlightSession.id !== depositSessionId) setValue("depositSessionId", inFlightSession.id)
      return
    }
    if (!sessionDraft) return
    // The id lives in the form so a wallet rejection, or a remount (the provider picker, a
    // source change and back), reuses the same record while it is still re-signable.
    const stored = depositSessionId ? readDepositSession(localStorage, depositSessionId) : null
    const reusable =
      !!stored && isSameIntent(stored, sessionDraft) && !isPhaseAdvance("send_prompt", stored.phase)
    const session = reusable ? stored : createDepositSession(sessionDraft)
    sessionRef.current = { intentKey, session }
    if (session.id !== depositSessionId) setValue("depositSessionId", session.id)
  }, [sessionDraft, intentKey, setValue, depositSessionId, inFlightSession])

  // A refresh awaited inside the click must not raise the wallet over a screen the user left.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // --- Persistence ----------------------------------------------------------
  // Pre-prompt writes must be durable, post-prompt writes must not be lost: `writeSession` is
  // the store's write, which falls back to an in-memory record this tab keeps serving.
  const { write: writeSession } = store
  const persist = useCallback((session: DepositSession): DepositSession => {
    // Read-back is inside writeDepositSession; a non-durable record of an intended transfer blocks signing.
    return writeDepositSession(localStorage, session)
  }, [])

  const composeSession = useCallback(
    (
      phase: DepositSession["phase"],
      extra: Partial<DepositSession> = {},
      draft: DepositSessionDraft | undefined = sessionDraft,
    ): DepositSession => {
      const current = sessionRef.current?.session
      if (!current || !draft) throw new Error("This deposit is not ready to send")
      return {
        ...current,
        ...draft,
        phase,
        updatedAt: Date.now(),
        ...extra,
      }
    },
    [sessionDraft],
  )

  /** Compose and durably record one phase, returning what was written. Throws when the write is not durable. */
  const persistPhase = useCallback(
    (
      phase: DepositSession["phase"],
      extra?: Partial<DepositSession>,
      draft?: DepositSessionDraft,
    ): DepositSession => {
      const session = composeSession(phase, extra, draft)
      persist(session)
      return session
    },
    [composeSession, persist],
  )

  // --- Approval -------------------------------------------------------------
  const approveMutation = useMutation({
    mutationFn: async () => {
      if (!approval) throw new Error("No approval is required")

      const provider = await getProvider()
      const signer = await provider.getSigner()
      await switchEthereumChain(provider, findSkipChain(source.chainId))
      const response = await signer.sendTransaction({
        chainId: Number(source.chainId),
        to: approval.token_address,
        data: encodeErc20Approve(approval.spender_address, approval.amount),
      })

      // Nothing to record: an approval moves no funds, and a lost one is re-derived from the
      // next allowance read rather than from a session.
      await pinnedProvider.waitForTransaction(response.hash, 1, APPROVAL_RECEIPT_TIMEOUT_MS)
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
      setApprovalError(await normalizeErrorMessage(error))
    },
  })

  // --- Send -----------------------------------------------------------------
  const sendMutation = useMutation({
    // `quote` is the one the click just re-read (LI.FI); the draft is built from it here
    // because a render with the refreshed quote is not guaranteed to have committed yet.
    mutationFn: async ({ quote }: { quote?: BridgeQuoteResponse }) => {
      const draft = transport === "lifi" && quote ? buildDraft(quote) : sessionDraft
      // Written and read back *before* the prompt: an in-flight transfer must never go undescribed.
      const prepared = persistPhase("prepared", undefined, draft)

      const provider = await getProvider()
      const signer = await provider.getSigner()
      await switchEthereumChain(provider, findSkipChain(prepared.transaction.chainId))

      // Any recent head precedes this prompt; a missing read is a missing hint (the scan degrades
      // to a plain receipt watch), never a reason to refuse a transfer the user asked for.
      const preSubmitBlock = blockQuery.data

      // Immediately before the wallet call, so a tab that disappears mid-prompt leaves evidence of a possible send.
      persistPhase(
        "send_prompt",
        preSubmitBlock === undefined ? undefined : { preSubmitBlock },
        draft,
      )

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
          // No hash came back, so nothing here proves the transfer was not broadcast. Recorded
          // here, from the draft that was signed; the same volatile fallback as a sent transfer.
          let recorded = true
          try {
            writeSession(composeSession("submission_unknown", undefined, draft))
          } catch {
            recorded = false
          }
          throw new UnknownSendError(message, recorded)
        }
        response = { hash: sentHash, from: hexAddress }
      }

      let sent = composeSession(
        "source_sent",
        {
          submitted: { hash: response.hash, nonce: response.nonce, from: response.from },
          currentSourceHash: response.hash,
          originalSourceHash: response.hash,
        },
        draft,
      )
      try {
        // Post-prompt, so the store's volatile fallback applies: the broadcast already happened
        // and losing the write must not lose the transfer. `write` merges over the send_prompt
        // record, keeping the pre-submit block, and hands back what the progress view reads.
        sent = writeSession(sent)
      } catch {
        // Nothing here may turn a broadcast transfer into a reported failure.
      }
      return { session: sent }
    },
    onMutate: () => {
      setSubmitError(undefined)
    },
    onSuccess: ({ session }) => {
      setValue("depositSessionId", session.id)
      setValue("page", "deposit-progress")
    },
    onError: async (error: unknown) => {
      if (error instanceof UnknownSendError) {
        setUnknownSend(true)
        // The locked form and the recovery reference are what the user acts on from here.
        if (!error.recorded) setStorageBlocked(true)
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

  const {
    refetch: refetchQuote,
    dataUpdatedAt: quoteUpdatedAt,
    isFetching: isFetchingQuote,
  } = quoteQuery

  const { mutate: send, isPending: isSending } = sendMutation
  const { mutate: startApproval, isPending: isApproving } = approveMutation

  // One click sends, like the Router preview: a stale quote is re-read inside the click and, when
  // it comes back describing the same transaction, that same click goes on to the wallet. Only a
  // materially changed quote costs a second click, and nothing is ever re-sent automatically.
  // The direct path has no gate at all — its call is the issued address and the typed amount, and
  // readiness already required the destination preflight to be quoted.
  const submit = useCallback(async () => {
    if (isSending || isApproving || isRefreshingQuote) return
    if (readiness.status !== "ready") return

    if (transport === "lifi" && (isQuoteStale(quoteUpdatedAt, Date.now()) || isFetchingQuote)) {
      setIsRefreshingQuote(true)
      try {
        // refetch() reports a failure as an absent result, which decides as "review" (an
        // unverified or unbound quote is never signed); readiness then shows the query's error.
        const { data } = await refetchQuote()
        if (!mountedRef.current) return
        const bound =
          data && isQuoteBoundToOptions(data.deposit_address, optionsData?.deposit_address)
        const refreshedSignature = bound ? bridgeQuoteSignature(data) : ""
        if (
          decideRefreshedQuote({ reviewedSignature: quoteSignature, refreshedSignature }) ===
          "review"
        ) {
          setReviewRequiredSignature(refreshedSignature)
          return
        }
        setReviewRequiredSignature("")
        send({ quote: data })
        return
      } finally {
        setIsRefreshingQuote(false)
      }
    }

    setReviewRequiredSignature("")
    // The reviewed quote travels with the call rather than through the mutation's closure.
    send({ quote: boundQuote })
  }, [
    boundQuote,
    isApproving,
    isFetchingQuote,
    isRefreshingQuote,
    isSending,
    optionsData?.deposit_address,
    quoteSignature,
    quoteUpdatedAt,
    readiness.status,
    refetchQuote,
    send,
    transport,
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
      error: approvalError,
      approve: approvalRequired ? approve : undefined,
    },
    readiness,
    submit,
    // One busy state: the click's own re-read is part of sending, not a separate action.
    isSubmitting: isSending || isRefreshingQuote,
    // The unrecoverable storage case is already a readiness blocker; this is a retryable attempt.
    submitError,
    nativeSymbol,
    legs,
    quoteUpdated,
    unknownSend: unknownSend || sessionInFlight,
    openProgress: () => setValue("page", "deposit-progress"),
    openRouteSelection: transport === "lifi" ? () => setValue("page", "select-route") : undefined,
  }
}

/** Marker for a send that provably never started (rejected prompt, node refusal): the session rolls back to `prepared` and the form reopens. */
class NotSentError extends Error {}

/** Marker for a wallet call that returned no hash. The form locks and never re-enables send. */
class UnknownSendError extends Error {
  constructor(
    message: string,
    /** False when the ambiguous state could not be written anywhere. */
    readonly recorded: boolean,
  ) {
    super(message)
  }
}

type DepositSessionDraft = Omit<
  DepositSession,
  "version" | "id" | "createdAt" | "updatedAt" | "phase"
>
