import type { BrowserProvider, JsonRpcSigner } from "ethers"
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react"
import { useDebounceValue } from "usehooks-ts"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useConfig } from "@/data/config"
import { normalizeError, normalizeErrorMessage } from "@/data/http"
import { useGetProvider } from "@/data/signer"
import { useLocationState } from "@/lib/router"
import { useFindSkipChain } from "@/pages/bridge/data/chains"
import { switchEthereumChain } from "@/pages/bridge/data/evm"
import { useHexAddress, useInitiaAddress } from "@/public/data/hooks"
import { depositQueryKeys, useDepositApi } from "../data/api"
import { createDepositAssetsQueryOptions } from "../data/assets"
import {
  bridgeQuoteSignature,
  createBridgeOptionsQueryOptions,
  createBridgeQuoteQueryOptions,
  isBridgeQuoteMateriallyChanged,
  rankBridgeOptions,
} from "../data/bridges"
import { useDepositAddress } from "../data/depositAddress"
import { eqAddress, gteInteger, isEvmTxHash, userErrorMessage } from "../data/parse"
import { createQuoteQueryOptions } from "../data/quote"
import { ETHEREUM_CHAIN_ID, ETHEREUM_USDC_DENOM, formatSourceMin } from "../data/source"
import type {
  BridgeQuoteApproval,
  BridgeQuoteResponse,
  BridgeRequestIdentity,
  DestinationNetwork,
} from "../data/types"
import {
  DepositInFlightError,
  type DepositIntent,
  type DepositSession,
  type DepositSessionDraft,
  DepositSessionWriteError,
  findInFlightSession,
  pruneDepositSessions,
  readDepositSession,
  reserveDepositPrompt,
  reuseOrCreateDepositSession,
  rollbackDepositSessionPrompt,
  useDepositSessionStore,
} from "./depositSession"
import { type DepositTransportResolution, resolveDepositTransport } from "./depositSources"
import {
  bridgeSelectionContext,
  buildDepositTransaction,
  combineEstimatedSeconds,
  deliverySeconds,
  deriveDepositReadiness,
  derivePreflight,
  isProvablyNotSent,
  isQuoteStale,
  requiredNativeAmount,
  resolveDepositRecipient,
  selectBridgeOption,
  toBaseUnitString,
  UNKNOWN_SEND_MESSAGE,
} from "./depositTransferLogic"
import {
  encodeErc20Approve,
  getPinnedProvider,
  readErc20Uint,
  type SenderNonces,
  SOURCE_READ_REFRESH_MS,
  usePinnedSourceBalances,
  useSenderNonces,
  useSourceChainHead,
  waitForApproval,
} from "./evmRpc"
import { useTransferFlow, useTransferForm } from "./transferFlowConfig"
import type { TransferLocationState } from "./transferNavigation"

export type DepositTransportSelection = Extract<
  DepositTransportResolution,
  { transport: "direct" | "lifi" }
>

const PROMPT_HEARTBEAT_MS = 15_000
// Two Ethereum blocks: a transfer at the wallet's suggested fee usually lands within them.
const ETHEREUM_CONFIRMATION_SECONDS = 24

const APPROVAL_RECEIPT_TIMEOUT_MS = 120_000

const isFirstFetch = (query: { isLoading: boolean; isPlaceholderData: boolean }) =>
  query.isLoading || query.isPlaceholderData

// Non-suspense: a Deposit API outage must not suspend the Router pairs in the same form.
export function useDepositTransportResolution() {
  const { mode } = useTransferFlow()
  const { depositApiUrl } = useConfig()
  const api = useDepositApi()
  const { watch } = useTransferForm()
  const [srcChainId, srcDenom, dstChainId, dstDenom] = watch([
    "srcChainId",
    "srcDenom",
    "dstChainId",
    "dstDenom",
  ])
  const hasDepositApi = !!depositApiUrl

  const { data, error, refetch, isFetching } = useQuery({
    ...createDepositAssetsQueryOptions(api),
    enabled: hasDepositApi && mode === "deposit",
  })

  const resolution = resolveDepositTransport({
    mode,
    hasDepositApi,
    srcChainId,
    srcDenom,
    dstChainId,
    dstDenom,
    catalog: data,
    catalogError: !!error,
  })

  return { resolution, retryCatalog: refetch, isCatalogFetching: isFetching }
}

interface DepositRequestState {
  identity: BridgeRequestIdentity
  recipient: string
  isHostRecipient: boolean
  recipientError?: string
  amount: string
  isComplete: boolean
}

export function useDepositRequest(resolution: DepositTransportResolution): DepositRequestState {
  const { watch } = useTransferForm()
  const quantity = watch("quantity")
  const { recipientAddress } = useLocationState<TransferLocationState>()
  const initiaAddress = useInitiaAddress()
  const hexAddress = useHexAddress()

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
      !!source &&
      !!destination &&
      gteInteger(amount, "1") &&
      !!hexAddress &&
      !!recipient &&
      !recipientError,
  }
}

export function useDeliveryQuote(
  destination: DestinationNetwork | undefined,
  amountIn: string,
  { poll = true }: { poll?: boolean } = {},
) {
  const api = useDepositApi()
  const params = {
    srcChainId: ETHEREUM_CHAIN_ID,
    srcDenom: ETHEREUM_USDC_DENOM,
    dstChainId: destination?.chain_id ?? "",
    dstDenom: destination?.denom ?? "",
    amountIn,
  }
  return useQuery({
    ...createQuoteQueryOptions(api, params, !!destination && !!amountIn),
    ...(!poll && { refetchInterval: false as const }),
  })
}

class UnknownSendError extends Error {}

const ATTEMPT_CHANGED_MESSAGE =
  "The deposit changed before your wallet opened. Review and try again."

/** The draft is bound at the click, with the inputs it was built from. */
interface DepositAttempt {
  draft: DepositSessionDraft
  inputs: string
}

// Locks the form for the life of this mount: nothing may reach the wallet again from it.
const isLockingError = (error: unknown): boolean =>
  error instanceof UnknownSendError || error instanceof DepositSessionWriteError

export type DepositTransferModel = ReturnType<typeof useDepositTransfer>

export function useDepositTransfer(resolution: DepositTransportSelection) {
  const { transport, source, route, destination } = resolution
  const api = useDepositApi()
  const { depositApiUrl = "", registryUrl } = useConfig()
  const queryClient = useQueryClient()
  const getProvider = useGetProvider()
  const findSkipChain = useFindSkipChain()
  const findChain = (chainId: string) => {
    try {
      return findSkipChain(chainId)
    } catch {
      return undefined
    }
  }
  const { setValue, getValues, watch } = useTransferForm()
  const [pickedBridge, pickedFor, quantity] = watch([
    "selectedBridge",
    "selectedBridgeFor",
    "quantity",
  ])
  const hexAddress = useHexAddress()
  const request = useDepositRequest(resolution)
  const { identity, recipient, recipientError, amount } = request
  const store = useDepositSessionStore()

  const [reviewRequiredSignature, setReviewRequiredSignature] = useState("")
  const [isRefreshingQuote, setIsRefreshingQuote] = useState(false)
  // Synchronous: a second click can land before React renders the mutation as pending.
  const busyRef = useRef(false)
  // What the last approval's wait saw on chain, the floor for the next deposit's nonce baseline.
  const approvalNoncesRef = useRef<{ chainId: string; sender: string; nonces: SenderNonces }>(null)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const balancesQuery = usePinnedSourceBalances({
    chainId: source.chainId,
    owner: hexAddress,
    token: source.denom,
  })
  const headQuery = useSourceChainHead(source.chainId)
  const noncesQuery = useSenderNonces(source.chainId, hexAddress, () => SOURCE_READ_REFRESH_MS)

  const optionsEnabled = transport === "lifi" && request.isComplete
  const optionsQuery = useQuery(createBridgeOptionsQueryOptions(api, identity, optionsEnabled))
  const optionsData = optionsEnabled ? optionsQuery.data : undefined
  const ranked = rankBridgeOptions(optionsData?.options ?? [])
  const isStalePick = !!pickedBridge && pickedFor !== bridgeSelectionContext(identity)
  const selectedBridgeKey = isStalePick ? "" : pickedBridge
  const { option: selectedBridge, clearSelection } = selectBridgeOption(ranked, selectedBridgeKey)

  // Cleared, not just ignored, so returning to the earlier amount doesn't bring the old pick back.
  useEffect(() => {
    if (clearSelection || isStalePick) setValue("selectedBridge", "")
  }, [clearSelection, isStalePick, setValue])

  const quoteQueryOptions = createBridgeQuoteQueryOptions(
    api,
    {
      ...identity,
      bridge: selectedBridge?.bridge ?? "",
      depositAddress: optionsData?.deposit_address,
    },
    optionsEnabled && !!selectedBridge,
  )
  const quoteQuery = useQuery(quoteQueryOptions)
  const quote = transport === "lifi" ? quoteQuery.data : undefined

  const depositAddressQuery = useDepositAddress({
    walletAddress: transport === "direct" ? recipient : "",
    chainId: destination.chain_id,
    assetDenom: destination.denom,
  })
  const depositAddress =
    transport === "direct" ? depositAddressQuery.data?.deposit_address : quote?.deposit_address

  // Below either minimum the USDC is stranded at the deposit address with no refund.
  const clearsLifiMinimums = (minReceived: string | undefined) =>
    gteInteger(minReceived, optionsData?.required_min_received ?? "") &&
    gteInteger(minReceived, route.min_deposit_amount)
  const meetsMinimum =
    transport === "lifi"
      ? clearsLifiMinimums(quote?.min_received)
      : gteInteger(amount, route.min_deposit_amount)
  // LI.FI must clear both minimums, so the label names the higher one.
  const requiredMin = optionsData?.required_min_received ?? ""
  const minimumLabel = formatSourceMin(
    transport === "lifi" && gteInteger(requiredMin, route.min_deposit_amount)
      ? requiredMin
      : route.min_deposit_amount,
    route.src_decimals,
    "USDC",
  )

  // The guaranteed amount, not the expected one, must clear the destination.
  const preflightAmount = transport === "lifi" ? (quote?.min_received ?? "") : amount
  const displayAmount = transport === "lifi" ? (quote?.amount_out ?? "") : amount
  const preflightQuery = useDeliveryQuote(destination, preflightAmount)
  const needsDisplayQuote = !!displayAmount && displayAmount !== preflightAmount
  const displayQuery = useDeliveryQuote(destination, needsDisplayQuote ? displayAmount : "")

  const preflight = derivePreflight({
    amountIn: preflightAmount,
    hasError: !!preflightQuery.error,
    result: preflightQuery.data,
    isPlaceholderData: preflightQuery.isPlaceholderData,
    failedAfter: preflightQuery.errorUpdatedAt - preflightQuery.dataUpdatedAt,
  })
  const displaySource = needsDisplayQuote ? displayQuery : preflightQuery
  const displayResult =
    displaySource.data && !displaySource.isPlaceholderData ? displaySource.data : undefined
  const displayQuote = displayResult?.status === "quoted" ? displayResult.quote : undefined
  const preflightQuote =
    preflightQuery.data?.status === "quoted" && !preflightQuery.isPlaceholderData
      ? preflightQuery.data.quote
      : undefined
  const deliveryQuote = displayQuote ?? preflightQuote
  const delivery = deliverySeconds(deliveryQuote, destination)
  // LI.FI's estimate runs from the source transaction; Initia's delivery starts once it's confirmed.
  const estimatedSeconds = combineEstimatedSeconds(
    transport === "lifi"
      ? [quote?.estimate.execution_duration_seconds, delivery]
      : [ETHEREUM_CONFIRMATION_SECONDS, delivery],
  )
  const typedAmount = toBaseUnitString(quantity, source.decimals)
  const isAmountSettled = typedAmount === amount
  const isEstimating =
    !isAmountSettled ||
    (transport === "lifi" && (isFirstFetch(optionsQuery) || quoteQuery.isLoading)) ||
    isFirstFetch(preflightQuery) ||
    (needsDisplayQuote && isFirstFetch(displayQuery))

  const approval = quote?.approval
  const spender = approval?.spender_address ?? ""
  const allowanceKey = depositQueryKeys.allowance(
    source.chainId,
    hexAddress,
    source.denom,
    spender,
  ).queryKey
  const allowanceQuery = useQuery({
    queryKey: allowanceKey,
    queryFn: () =>
      readErc20Uint(getPinnedProvider(source.chainId), source.denom, "allowance", [
        hexAddress,
        spender,
      ]),
    enabled: !!hexAddress && !!approval,
    staleTime: SOURCE_READ_REFRESH_MS,
  })
  const approvalRequired =
    !!approval &&
    allowanceQuery.data !== undefined &&
    BigInt(allowanceQuery.data) < BigInt(approval.amount)
  const approvalChecking = !!approval && allowanceQuery.data === undefined && !allowanceQuery.error
  // An unreadable allowance is not "no approval needed": the send would revert after the user paid gas.
  const allowanceError =
    approval && allowanceQuery.error ? "Could not check the USDC allowance" : undefined

  const quoteSignature = quote ? bridgeQuoteSignature(quote) : ""
  const quoteUpdated = !!reviewRequiredSignature && reviewRequiredSignature === quoteSignature

  const sourceLeg = {
    name: source.chainName,
    logoUrl: findChain(source.chainId)?.logo_uri ?? "",
  }
  const destinationChain = findChain(destination.chain_id)
  const destinationLeg = {
    name: destinationChain?.pretty_name || destination.chain_name,
    logoUrl: destinationChain?.logo_uri ?? "",
  }
  const legs =
    transport === "lifi"
      ? [
          sourceLeg,
          { name: "Ethereum", logoUrl: findChain(ETHEREUM_CHAIN_ID)?.logo_uri ?? "" },
          destinationLeg,
        ]
      : [sourceLeg, destinationLeg]

  const buildDraft = (quote: BridgeQuoteResponse | undefined): DepositSessionDraft | undefined => {
    const depositAddress =
      transport === "direct" ? depositAddressQuery.data?.deposit_address : quote?.deposit_address
    if (!recipient || !hexAddress || !amount || !depositAddress) return undefined
    const transaction =
      transport === "direct"
        ? buildDepositTransaction({ transport, depositAddress, amount })
        : quote && buildDepositTransaction({ transport, quote })
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
        chainName: sourceLeg.name,
        chainLogoUrl: sourceLeg.logoUrl,
        assetLogoUrl: `${registryUrl}/images/${source.symbol}.png`,
      },
      destination: {
        chainId: destination.chain_id,
        denom: destination.denom,
        recipient,
        decimals: destination.decimals,
        symbol: route.dst_symbol,
        chainName: destinationLeg.name,
        chainLogoUrl: destinationLeg.logoUrl,
        assetLogoUrl: `${registryUrl}/images/${route.dst_symbol}.png`,
      },
      depositAddress,
      transaction,
      predictedDelivery: deliveryQuote?.delivery?.method,
    }
  }
  const draftTransaction = buildDraft(quote)?.transaction
  const nativeCost = (transaction?: DepositSessionDraft["transaction"]) =>
    requiredNativeAmount({
      value: transaction?.value,
      gasLimit: transaction?.gasLimit,
      maxFeePerGas: headQuery.data?.maxFeePerGas,
    })
  const coversNativeCost = (transaction: DepositSessionDraft["transaction"]) => {
    const required = nativeCost(transaction)
    const native = balancesQuery.data?.native
    return !required || (native !== undefined && BigInt(native) >= BigInt(required))
  }

  const intent: DepositIntent = {
    apiUrl: depositApiUrl,
    transport,
    source: { chainId: source.chainId, denom: source.denom, sender: hexAddress },
    destination: { chainId: destination.chain_id, denom: destination.denom, recipient },
  }
  const sessions = useMemo(() => store.list(depositApiUrl), [store, depositApiUrl])
  // Open prompt or ambiguous send for this transfer on any mount or tab: never sign it again here.
  const inFlightSession =
    hexAddress && recipient ? findInFlightSession(sessions, intent) : undefined

  const getSigner = async (chainId: string, sender = hexAddress) => {
    const chain = findChain(chainId)
    if (!chain) throw new Error(`Chain not found: ${chainId}`)
    // Balances, allowance and nonce were read for this account; the watch assumes it sent.
    const signerFor = async (provider: BrowserProvider) => {
      const signer = await provider.getSigner()
      if (!eqAddress(signer.address, sender)) {
        throw new Error("Your wallet switched accounts. Try again.")
      }
      return signer
    }
    const provider = await getProvider()
    const signer = await signerFor(provider)
    // Asked of the wallet itself: a stale cached chain would make ethers refuse the send.
    const walletChainId = Number(await provider.send("eth_chainId", []))
    if (walletChainId === Number(chainId)) return signer
    await switchEthereumChain(provider, chain)
    // A provider that already detected the old chain can refuse to send on the new one.
    return signerFor(await getProvider())
  }

  const approveMutation = useMutation({
    networkMode: "always",
    mutationFn: async (approval: BridgeQuoteApproval) => {
      try {
        const signer = await getSigner(source.chainId)
        // A chain switch can outlast the form; a closed form never opens the approval prompt.
        if (!mountedRef.current) throw new Error(ATTEMPT_CHANGED_MESSAGE)
        // Mined before the prompt, so the approval takes this nonce or a later one, even when it replaces
        // an earlier pending transaction. The wallet's hash is enough: sendTransaction would also wait on
        // the wallet's node, which may never return it.
        const nonceFloor = noncesQuery.data?.latest
        if (nonceFloor === undefined) throw new Error("This deposit is not ready to send")
        const hash = await signer.sendUncheckedTransaction({
          chainId: Number(source.chainId),
          to: approval.token_address,
          data: encodeErc20Approve(approval.spender_address, approval.amount),
        })
        const confirmed = await waitForApproval(
          getPinnedProvider(source.chainId),
          {
            hash,
            nonce: nonceFloor,
            owner: signer.address,
            token: approval.token_address,
            spender: approval.spender_address,
            amount: approval.amount,
          },
          APPROVAL_RECEIPT_TIMEOUT_MS,
        )
        // A re-read could hit a node behind the one that saw the approval, so keep what it saw.
        await queryClient.cancelQueries({ queryKey: allowanceKey })
        queryClient.setQueryData(allowanceKey, confirmed.allowance)
        approvalNoncesRef.current = {
          chainId: source.chainId,
          sender: signer.address,
          nonces: confirmed.nonces,
        }
      } catch (error) {
        throw await normalizeError(error)
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: quoteQueryOptions.queryKey })
    },
  })

  // The prompt already happened, so a lost write must not turn into a reported failure.
  const writeAfterPrompt = (session: DepositSession) => {
    try {
      store.write(session)
    } catch {
      // The durable send_prompt record still locks this transfer.
    }
  }

  // The click that started this send still owns it: same inputs, and the form still open.
  const isCurrentAttempt = (inputs: string) => mountedRef.current && inputsRef.current === inputs

  const sendDeposit = async ({ draft, inputs }: DepositAttempt) => {
    if (!isCurrentAttempt(inputs)) throw new Error(ATTEMPT_CHANGED_MESSAGE)
    // The head and nonces below are read for the connected account and source chain.
    if (!eqAddress(draft.source.sender, hexAddress) || draft.source.chainId !== source.chainId) {
      throw new Error("Your wallet switched accounts. Try again.")
    }
    const preSubmitBlock = headQuery.data?.block
    const read = noncesQuery.data
    if (preSubmitBlock === undefined || !read) {
      throw new Error("This deposit is not ready to send")
    }
    // A node behind the approval's must not lower the baseline hashless recovery compares against.
    const approved = approvalNoncesRef.current
    const nonces =
      approved &&
      approved.chainId === draft.source.chainId &&
      eqAddress(approved.sender, draft.source.sender)
        ? {
            latest: Math.max(read.latest, approved.nonces.latest),
            pending: Math.max(read.pending, approved.nonces.pending),
          }
        : read

    const storedId = getValues("depositSessionId")
    const stored = storedId ? readDepositSession(localStorage, storedId) : null
    pruneDepositSessions(localStorage, Date.now())
    // Written and read back before any wallet prompt, the chain switch included.
    const prompted = await reserveDepositPrompt({
      ...reuseOrCreateDepositSession(stored, draft),
      ...draft,
      phase: "send_prompt",
      preSubmitBlock,
      promptedAt: Date.now(),
      promptNonce: nonces.latest,
      promptPendingNonce: nonces.pending,
      updatedAt: Date.now(),
    })
    // The lock can wait on another tab; the click may no longer own this send by the time it's held.
    if (!isCurrentAttempt(inputs)) {
      rollbackDepositSessionPrompt(localStorage, prompted.id)
      throw new Error(ATTEMPT_CHANGED_MESSAGE)
    }
    setValue("depositSessionId", prompted.id)

    // While this tab holds the prompt open, other tabs must not read it as abandoned.
    const heartbeat = setInterval(() => {
      const current = readDepositSession(localStorage, prompted.id)
      if (current?.phase !== "send_prompt" || current.currentSourceHash) {
        clearInterval(heartbeat)
        return
      }
      writeAfterPrompt({ ...current, promptSeenAt: Date.now(), updatedAt: Date.now() })
    }, PROMPT_HEARTBEAT_MS)

    let hash: string
    let signer: JsonRpcSigner
    try {
      // Nothing is broadcast before the send itself.
      const rollback = (error: unknown): never => {
        rollbackDepositSessionPrompt(localStorage, prompted.id)
        throw error
      }
      signer = await getSigner(prompted.transaction.chainId, prompted.source.sender).catch(rollback)
      const { transaction } = prompted
      const request = {
        chainId: Number(transaction.chainId),
        to: transaction.to,
        data: transaction.data,
        value: BigInt(transaction.value),
      }
      // Estimated here rather than inside sendTransaction, so a failed estimate is provably not sent.
      const gasLimit = transaction.gasLimit
        ? BigInt(transaction.gasLimit)
        : await signer.estimateGas(request).catch(rollback)
      // The chain switch and estimate can take a while; an edit or a closed form cancels the send.
      if (!isCurrentAttempt(inputs)) rollback(new Error(ATTEMPT_CHANGED_MESSAGE))
      // Recorded the moment the wallet answers. sendTransaction would first wait for the wallet's own
      // node to return the transaction, which a private mempool or lost response can stretch forever.
      // The tracker learns the nonce from the pinned node.
      hash = await signer
        .sendUncheckedTransaction({ ...request, gasLimit })
        .catch(async (error: unknown) => {
          const message = await normalizeErrorMessage(error)
          if (isProvablyNotSent(error, message)) {
            rollbackDepositSessionPrompt(localStorage, prompted.id)
            throw error
          }
          writeAfterPrompt({ ...prompted, phase: "submission_unknown" })
          throw new UnknownSendError(message)
        })
      if (!isEvmTxHash(hash)) {
        writeAfterPrompt({ ...prompted, phase: "submission_unknown" })
        throw new UnknownSendError(UNKNOWN_SEND_MESSAGE)
      }
    } finally {
      clearInterval(heartbeat)
    }

    writeAfterPrompt({
      ...prompted,
      phase: "source_sent",
      currentSourceHash: hash,
      originalSourceHash: hash,
    })
    // The pinned node may never see a privately sent transfer, and without its nonce a replacement
    // can't be found. The wallet's own node knows it; a miss leaves the tracker to learn it.
    void signer.provider
      .getTransaction(hash)
      .then((sent) => {
        const current = readDepositSession(localStorage, prompted.id)
        if (sent && current && current.sourceNonce === undefined) {
          writeAfterPrompt({ ...current, sourceNonce: sent.nonce })
        }
      })
      .catch(() => {})
  }

  // Never paused and resumed later: a deferred wallet prompt would outlive the click that asked for it.
  const sendMutation = useMutation({
    networkMode: "always",
    // The draft is built at the click, so a mutation that runs later can't pick up newer form state.
    mutationFn: async (attempt: DepositAttempt) => {
      try {
        await sendDeposit(attempt)
      } catch (error) {
        throw isLockingError(error) ? error : await normalizeError(error)
      }
    },
    onSuccess: () => setValue("page", "deposit-progress"),
  })

  const sendError = sendMutation.error
  const unknownSend = sendError instanceof UnknownSendError
  const storageBlocked = sendError instanceof DepositSessionWriteError
  // Once another tab's reservation reaches this one, readiness already says the transfer is in flight.
  const duplicatesInFlight = sendError instanceof DepositInFlightError && !!inFlightSession
  const submitError =
    sendError && !isLockingError(sendError) && !duplicatesInFlight ? sendError.message : undefined

  const readiness = deriveDepositReadiness({
    transport,
    unknownSend,
    sessionInFlight: !!inFlightSession,
    storageBlocked,
    recipientError,
    quantityEntered: !!quantity,
    isAmountSettled,
    amount,
    // A failed refresh keeps the last balance; estimateGas refuses a send it no longer covers.
    balancesError: !!balancesQuery.error && balancesQuery.data === undefined,
    tokenBalance: balancesQuery.data?.token,
    nativeBalance: balancesQuery.data?.native,
    requiredNative: nativeCost(draftTransaction),
    sourceChainLoaded: headQuery.data !== undefined && noncesQuery.data !== undefined,
    sourceChainError:
      (headQuery.isError && headQuery.data === undefined) ||
      (noncesQuery.isError && noncesQuery.data === undefined),
    optionsError: userErrorMessage(optionsQuery.error),
    hasOptions: !!optionsData && !optionsQuery.isPlaceholderData,
    hasEligibleOption: !!selectedBridge,
    // A failed refresh keeps a fresh quote for these inputs; the send re-reads one that aged out.
    quoteError: userErrorMessage(
      quoteQuery.data === undefined ||
        quoteQuery.isPlaceholderData ||
        isQuoteStale(quoteQuery.dataUpdatedAt, quoteQuery.errorUpdatedAt)
        ? quoteQuery.error
        : null,
    ),
    hasQuote: !!quote,
    meetsMinimum,
    minimumLabel,
    approvalChecking,
    approvalError: allowanceError,
    depositAddressError: depositAddressQuery.error
      ? "Couldn't get your deposit address. Try again."
      : undefined,
    hasDepositAddress: !!depositAddress,
    preflight: preflight.status,
    preflightReason: preflight.reason,
  })

  const transferInputs = [
    source.chainId,
    source.denom,
    destination.chain_id,
    destination.denom,
    hexAddress,
    recipient,
    quantity,
    amount,
    selectedBridge?.bridge,
  ].join("|")
  const inputsRef = useRef(transferInputs)
  // An edit starts a new attempt, so the last one's error no longer applies. An ambiguous send keeps
  // its lock, and a request still in flight keeps its state.
  const clearSettledErrors = useEffectEvent(() => {
    if (sendMutation.isError && !isLockingError(sendMutation.error)) sendMutation.reset()
    if (approveMutation.isError) approveMutation.reset()
  })
  useEffect(() => {
    inputsRef.current = transferInputs
    clearSettledErrors()
  }, [transferInputs])

  // Only a re-read that isn't materially different from `reviewed` may go on to the wallet in the same click.
  const refreshQuote = async (
    reviewed: BridgeQuoteResponse,
  ): Promise<BridgeQuoteResponse | undefined> => {
    setIsRefreshingQuote(true)
    try {
      const { data, isError } = await quoteQuery.refetch()
      if (!mountedRef.current) return undefined
      const verified = !isError ? data : undefined
      // The re-read's guarantee is signed without a render, so it must clear the minimums itself.
      if (
        !verified ||
        isBridgeQuoteMateriallyChanged(reviewed, verified) ||
        !clearsLifiMinimums(verified.min_received)
      ) {
        setReviewRequiredSignature(verified ? bridgeQuoteSignature(verified) : "")
        return undefined
      }
      return verified
    } finally {
      setIsRefreshingQuote(false)
    }
  }

  const send = async (reviewed: BridgeQuoteResponse | undefined) => {
    if (busyRef.current || readiness.status !== "ready" || approvalRequired) return
    busyRef.current = true
    const inputs = transferInputs
    let locked = false
    try {
      let signed = quote
      const refresh =
        transport === "lifi" &&
        (isQuoteStale(quoteQuery.dataUpdatedAt, Date.now()) || quoteQuery.isFetching)
      if (refresh) {
        signed = reviewed && (await refreshQuote(reviewed))
        // An edit while the quote was re-read cancels this send; the draft must match the form.
        if (!signed || inputsRef.current !== inputs) return
      }
      const draft = buildDraft(signed)
      if (!draft) return
      // The button's balance check priced the displayed quote; the re-read's native cost can differ.
      // Readiness shows the shortfall once the re-read renders.
      if (refresh && !coversNativeCost(draft.transaction)) return
      setReviewRequiredSignature("")
      await sendMutation.mutateAsync({ draft, inputs })
    } catch (error) {
      locked = isLockingError(error)
    } finally {
      busyRef.current = locked
    }
  }

  const approve = async () => {
    if (busyRef.current || !approval || !quote) return
    busyRef.current = true
    // Clicking is the review: a pending "Route updated" is settled by this click.
    setReviewRequiredSignature("")
    try {
      await approveMutation.mutateAsync(approval)
    } catch {
      // Shown through the mutation's error.
    } finally {
      busyRef.current = false
    }
  }

  return {
    transport,
    route,
    destination,
    recipient,
    isHostRecipient: request.isHostRecipient,
    depositAddress,
    quote,
    hasAmount: gteInteger(typedAmount, "1"),
    isEstimating,
    estimatedAmountOut: displayQuote?.amount_out,
    estimatedSeconds,
    approval: {
      isApproving: approveMutation.isPending,
      error: approveMutation.error?.message,
      approve: approvalRequired ? approve : undefined,
    },
    readiness,
    submit: () => send(quote),
    isSubmitting: sendMutation.isPending || isRefreshingQuote,
    submitError,
    legs,
    quoteUpdated,
    unknownSend: unknownSend || !!inFlightSession,
    openProgress: () => {
      if (inFlightSession) setValue("depositSessionId", inFlightSession.id)
      setValue("page", "deposit-progress")
    },
    openRouteSelection: transport === "lifi" ? () => setValue("page", "select-route") : undefined,
    // The same pick the route picker marks "Best", whether it was chosen for the user or by them.
    isBestRoute:
      !!selectedBridge &&
      selectedBridge.bridge === ranked.find((option) => option.eligible)?.bridge,
  }
}
