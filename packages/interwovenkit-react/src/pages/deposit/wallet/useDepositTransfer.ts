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
  rankBridgeOptions,
} from "../data/bridges"
import { useDepositAddress } from "../data/depositAddress"
import { eqAddress, gteInteger, userErrorMessage } from "../data/parse"
import { createQuoteQueryOptions } from "../data/quote"
import { ETHEREUM_CHAIN_ID, ETHEREUM_USDC_DENOM, formatSourceMin } from "../data/source"
import type {
  BridgeQuoteApproval,
  BridgeQuoteResponse,
  BridgeRequestIdentity,
  DestinationNetwork,
} from "../data/types"
import {
  type DepositIntent,
  type DepositSession,
  type DepositSessionDraft,
  DepositSessionWriteError,
  findInFlightSession,
  pruneDepositSessions,
  readDepositSession,
  reuseOrCreateDepositSession,
  rollbackDepositSessionPrompt,
  useDepositSessionStore,
  writeDepositSession,
} from "./depositSession"
import { type DepositTransportResolution, resolveDepositTransport } from "./depositSources"
import {
  buildDepositTransaction,
  combineEstimatedSeconds,
  deliverySeconds,
  deriveDepositReadiness,
  derivePreflight,
  isProvablyNotSent,
  isQuoteStale,
  nextAutoDepositStep,
  requiredNativeAmount,
  resolveDepositRecipient,
  selectBridgeOption,
  sendTransactionHashOf,
  toBaseUnitString,
} from "./depositTransferLogic"
import {
  encodeErc20Approve,
  getPinnedProvider,
  readErc20Uint,
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
      !!source && !!destination && !!amount && !!hexAddress && !!recipient && !recipientError,
  }
}

export function useDeliveryQuote(
  destination: DestinationNetwork | undefined,
  amountIn: string,
  refetchInterval?: false,
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
    ...(refetchInterval === false && { refetchInterval }),
  })
}

class UnknownSendError extends Error {}

interface AutoDeposit {
  inputs: string
  quoteSignature: string
  approved: boolean
}

// Locks the form for the life of this mount: nothing may reach the wallet again from it.
const isLockingError = (error: unknown): boolean =>
  error instanceof UnknownSendError || error instanceof DepositSessionWriteError

export type DepositTransferModel = ReturnType<typeof useDepositTransfer>

export function useDepositTransfer(resolution: DepositTransportSelection) {
  const { transport, source, route, destination } = resolution
  const api = useDepositApi()
  const { depositApiUrl = "" } = useConfig()
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
  const [selectedBridgeKey, quantity] = watch(["selectedBridge", "quantity"])
  const hexAddress = useHexAddress()
  const request = useDepositRequest(resolution)
  const { identity, recipient, recipientError, amount } = request
  const store = useDepositSessionStore()

  const [reviewRequiredSignature, setReviewRequiredSignature] = useState("")
  const [isRefreshingQuote, setIsRefreshingQuote] = useState(false)
  // Synchronous: a second click can land before React renders the mutation as pending.
  const busyRef = useRef(false)
  // Held by this mount only, so a remount, reload, or another tab never sends it.
  const [autoDeposit, setAutoDeposit] = useState<AutoDeposit | null>(null)
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
  const { option: selectedBridge, clearSelection } = selectBridgeOption(ranked, selectedBridgeKey)

  useEffect(() => {
    if (clearSelection) setValue("selectedBridge", "")
  }, [clearSelection, setValue])

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
  const meetsMinimum =
    transport === "lifi"
      ? gteInteger(quote?.min_received, optionsData?.required_min_received ?? "") &&
        gteInteger(quote?.min_received, route.min_deposit_amount)
      : gteInteger(amount, route.min_deposit_amount)
  const minimumLabel = formatSourceMin(route.min_deposit_amount, route.src_decimals, "USDC")

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
  const estimatedSeconds = combineEstimatedSeconds(
    transport === "lifi" ? [quote?.estimate.execution_duration_seconds, delivery] : [delivery],
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
      },
      destination: {
        chainId: destination.chain_id,
        denom: destination.denom,
        recipient,
        symbol: route.dst_symbol,
        chainName: destinationLeg.name,
        chainLogoUrl: destinationLeg.logoUrl,
      },
      depositAddress,
      transaction,
      predictedDelivery: deliveryQuote?.delivery?.method,
    }
  }
  const draftTransaction = buildDraft(quote)?.transaction

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

  const getSigner = async (chainId: string) => {
    const chain = findChain(chainId)
    if (!chain) throw new Error(`Chain not found: ${chainId}`)
    const provider = await getProvider()
    const signer = await provider.getSigner()
    // Balances, allowance and nonce were read for this account; the watch assumes it sent.
    if (!eqAddress(signer.address, hexAddress)) {
      throw new Error("Your wallet switched accounts. Try again.")
    }
    // Asked of the wallet itself: a stale cached chain would make ethers refuse the send.
    const walletChainId = Number(await provider.send("eth_chainId", []))
    if (walletChainId !== Number(chainId)) await switchEthereumChain(provider, chain)
    return signer
  }

  const approveMutation = useMutation({
    mutationFn: async (approval: BridgeQuoteApproval) => {
      try {
        const signer = await getSigner(source.chainId)
        const response = await signer.sendTransaction({
          chainId: Number(source.chainId),
          to: approval.token_address,
          data: encodeErc20Approve(approval.spender_address, approval.amount),
        })
        await waitForApproval(
          getPinnedProvider(source.chainId),
          response.hash,
          APPROVAL_RECEIPT_TIMEOUT_MS,
        )
        // The next prompt must record the nonce after the approval's and see the raised allowance.
        await Promise.all([noncesQuery.refetch(), allowanceQuery.refetch()])
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

  const sendDeposit = async (quote: BridgeQuoteResponse | undefined) => {
    const draft = buildDraft(quote)
    const preSubmitBlock = headQuery.data?.block
    const promptNonce = noncesQuery.data?.latest
    if (!draft || preSubmitBlock === undefined || promptNonce === undefined) {
      throw new Error("This deposit is not ready to send")
    }

    const storedId = getValues("depositSessionId")
    const stored = storedId ? readDepositSession(localStorage, storedId) : null
    pruneDepositSessions(localStorage, Date.now())
    // Written and read back before any wallet prompt, the chain switch included.
    const prompted = writeDepositSession(localStorage, {
      ...reuseOrCreateDepositSession(stored, draft),
      ...draft,
      phase: "send_prompt",
      preSubmitBlock,
      promptedAt: Date.now(),
      promptNonce,
      updatedAt: Date.now(),
    })
    setValue("depositSessionId", prompted.id)

    // While this tab holds the prompt open, other tabs must not read it as abandoned.
    const heartbeat = setInterval(() => {
      const current = readDepositSession(localStorage, prompted.id)
      if (!mountedRef.current || current?.phase !== "send_prompt" || current.currentSourceHash) {
        clearInterval(heartbeat)
        return
      }
      writeAfterPrompt({ ...current, promptSeenAt: Date.now(), updatedAt: Date.now() })
    }, PROMPT_HEARTBEAT_MS)

    let response: { hash: string; nonce?: number }
    try {
      // Nothing is broadcast before the send itself.
      const signer = await getSigner(prompted.transaction.chainId).catch((error: unknown) => {
        rollbackDepositSessionPrompt(localStorage, prompted.id)
        throw error
      })
      const { transaction } = prompted
      response = await signer
        .sendTransaction({
          chainId: Number(transaction.chainId),
          to: transaction.to,
          data: transaction.data,
          value: BigInt(transaction.value),
          ...(transaction.gasLimit ? { gasLimit: BigInt(transaction.gasLimit) } : {}),
        })
        .catch(async (error: unknown) => {
          // A hash proves the broadcast, whatever the error says.
          const hash = sendTransactionHashOf(error)
          if (hash) return { hash }
          const message = await normalizeErrorMessage(error)
          if (isProvablyNotSent(message)) {
            rollbackDepositSessionPrompt(localStorage, prompted.id)
            throw error
          }
          writeAfterPrompt({ ...prompted, phase: "submission_unknown" })
          throw new UnknownSendError(message)
        })
    } finally {
      clearInterval(heartbeat)
    }

    writeAfterPrompt({
      ...prompted,
      phase: "source_sent",
      sourceNonce: response.nonce,
      currentSourceHash: response.hash,
      originalSourceHash: response.hash,
    })
  }

  const sendMutation = useMutation({
    mutationFn: async (quote: BridgeQuoteResponse | undefined) => {
      try {
        await sendDeposit(quote)
      } catch (error) {
        throw isLockingError(error) ? error : await normalizeError(error)
      }
    },
    onSuccess: () => setValue("page", "deposit-progress"),
  })

  const sendError = sendMutation.error
  const unknownSend = sendError instanceof UnknownSendError
  const storageBlocked = sendError instanceof DepositSessionWriteError
  const submitError = sendError && !isLockingError(sendError) ? sendError.message : undefined

  const readiness = deriveDepositReadiness({
    transport,
    unknownSend,
    sessionInFlight: !!inFlightSession,
    storageBlocked,
    recipientError,
    quantityEntered: !!quantity,
    isAmountSettled,
    amount,
    balancesError: !!balancesQuery.error,
    tokenBalance: balancesQuery.data?.token,
    nativeBalance: balancesQuery.data?.native,
    requiredNative: requiredNativeAmount({
      value: draftTransaction?.value,
      gasLimit: draftTransaction?.gasLimit,
      maxFeePerGas: headQuery.data?.maxFeePerGas,
    }),
    sourceChainLoaded: headQuery.data !== undefined && noncesQuery.data !== undefined,
    optionsError: userErrorMessage(optionsQuery.error),
    hasOptions: !!optionsData && !optionsQuery.isPlaceholderData,
    hasEligibleOption: !!selectedBridge,
    quoteError: userErrorMessage(quoteQuery.error),
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

  // Only an unchanged re-read may go on to the wallet in the same click.
  const refreshQuote = async (): Promise<BridgeQuoteResponse | undefined> => {
    setIsRefreshingQuote(true)
    try {
      const { data, isError } = await quoteQuery.refetch()
      if (!mountedRef.current) return undefined
      const verified = !isError ? data : undefined
      const signature = verified ? bridgeQuoteSignature(verified) : ""
      if (!signature || signature !== quoteSignature) {
        setReviewRequiredSignature(signature)
        return undefined
      }
      return verified
    } finally {
      setIsRefreshingQuote(false)
    }
  }

  const submit = async () => {
    if (busyRef.current || readiness.status !== "ready" || approvalRequired) return
    busyRef.current = true
    setAutoDeposit(null)
    let locked = false
    try {
      let reviewed = quote
      if (
        transport === "lifi" &&
        (isQuoteStale(quoteQuery.dataUpdatedAt, Date.now()) || quoteQuery.isFetching)
      ) {
        reviewed = await refreshQuote()
        if (!reviewed) return
      }
      setReviewRequiredSignature("")
      await sendMutation.mutateAsync(reviewed)
    } catch (error) {
      locked = isLockingError(error)
    } finally {
      busyRef.current = locked
    }
  }

  const autoDepositInputs = [
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

  const approveAndDeposit = async () => {
    if (busyRef.current || !approval) return
    busyRef.current = true
    const pending = { inputs: autoDepositInputs, quoteSignature, approved: false }
    setAutoDeposit(pending)
    try {
      await approveMutation.mutateAsync(approval)
      setAutoDeposit((current) => (current === pending ? { ...pending, approved: true } : current))
    } catch {
      setAutoDeposit((current) => (current === pending ? null : current))
    } finally {
      busyRef.current = false
    }
  }

  // An effect event, so the send reads the committed render's readiness, quote, and draft.
  const advanceAutoDeposit = useEffectEvent(() => {
    if (!autoDeposit) return
    const step = nextAutoDepositStep({
      approved: autoDeposit.approved,
      inputsChanged: autoDeposit.inputs !== autoDepositInputs,
      readiness: readiness.status,
      approvalRequired,
      quoteChanged: autoDeposit.quoteSignature !== quoteSignature,
    })
    if (step === "wait") return
    setAutoDeposit(null)
    if (step === "review") setReviewRequiredSignature(quoteSignature)
    if (step === "send") void submit()
  })
  useEffect(() => {
    advanceAutoDeposit()
  }, [autoDeposit, autoDepositInputs, readiness.status, approvalRequired, quoteSignature])

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
      approve: approvalRequired ? approveAndDeposit : undefined,
    },
    readiness,
    submit,
    isSubmitting: sendMutation.isPending || isRefreshingQuote || !!autoDeposit?.approved,
    submitError,
    legs,
    quoteUpdated,
    unknownSend: unknownSend || !!inFlightSession,
    openProgress: () => {
      if (inFlightSession) setValue("depositSessionId", inFlightSession.id)
      setValue("page", "deposit-progress")
    },
    openRouteSelection: transport === "lifi" ? () => setValue("page", "select-route") : undefined,
  }
}
