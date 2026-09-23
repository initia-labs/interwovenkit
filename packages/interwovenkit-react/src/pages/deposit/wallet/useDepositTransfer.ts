import { useEffect, useMemo, useRef, useState } from "react"
import { useDebounceValue } from "usehooks-ts"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useConfig } from "@/data/config"
import { normalizeError, normalizeErrorMessage } from "@/data/http"
import { useGetProvider } from "@/data/signer"
import { useLocationState } from "@/lib/router"
import { switchEthereumChain } from "@/pages/bridge/data/evm"
import { useHexAddress, useInitiaAddress } from "@/public/data/hooks"
import { depositQueryKeys, useDepositApi } from "../data/api"
import { createDepositAssetsQueryOptions } from "../data/assets"
import {
  bridgeQuoteSignature,
  createBridgeOptionsQueryOptions,
  createBridgeQuoteQueryOptions,
  meetsRequiredMinimum,
  rankBridgeOptions,
} from "../data/bridges"
import { useDepositAddress } from "../data/depositAddress"
import { createQuoteQueryOptions } from "../data/quote"
import { ETHEREUM_CHAIN_ID, ETHEREUM_USDC_DENOM, formatSourceMin } from "../data/source"
import type {
  Asset,
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
  type DepositReadiness,
  deriveDepositReadiness,
  derivePreflight,
  gteInteger,
  isProvablyNotSent,
  isQuoteBoundToOptions,
  isQuoteStale,
  requiredNativeAmount,
  resolveDepositRecipient,
  selectBridgeOption,
  sendTransactionHashOf,
  toBaseUnitString,
} from "./depositTransferLogic"
import {
  encodeErc20Approve,
  getPinnedProvider,
  readAllowance,
  usePinnedSourceBalances,
  useSourceChainHead,
  waitForApproval,
} from "./evmRpc"
import { useFindTransferChain } from "./externalAssets"
import { useTransferFlow, useTransferForm } from "./transferFlowConfig"
import type { TransferLocationState } from "./transferNavigation"

export type DepositTransportSelection = Extract<
  DepositTransportResolution,
  { transport: "direct" | "lifi" }
>

export interface DepositTransferModel {
  transport: "direct" | "lifi"
  route: Asset
  destination: DestinationNetwork
  recipient: string
  isHostRecipient: boolean
  /** The bound LI.FI quote; undefined on the direct path. */
  quote?: BridgeQuoteResponse
  estimatedAmountOut?: string
  estimatedSeconds?: number
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
  legs: { name: string; logoUrl: string }[]
  quoteUpdated: boolean
  unknownSend: boolean
  openProgress: () => void
  openRouteSelection?: () => void
}

const SOURCE_READ_REFRESH_MS = 15_000
const APPROVAL_RECEIPT_TIMEOUT_MS = 120_000

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

// Shared with SelectDepositRoute so both read the same options cache entry.
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

class UnknownSendError extends Error {}

// Locks the form for the life of this mount: nothing may reach the wallet again from it.
const isLockingError = (error: unknown): boolean =>
  error instanceof UnknownSendError || error instanceof DepositSessionWriteError

export function useDepositTransfer(resolution: DepositTransportSelection): DepositTransferModel {
  const { transport, source, route, destination } = resolution
  const api = useDepositApi()
  const { depositApiUrl = "" } = useConfig()
  const queryClient = useQueryClient()
  const getProvider = useGetProvider()
  const findChain = useFindTransferChain()
  const { setValue, getValues, watch } = useTransferForm()
  const [selectedBridgeKey, quantity] = watch(["selectedBridge", "quantity"])
  const hexAddress = useHexAddress()
  const request = useDepositRequest(resolution)
  const { identity, recipient, recipientError, amount } = request
  const store = useDepositSessionStore()

  // The signature a click's re-read produced when it differed, so the notice clears once the quote moves on.
  const [reviewRequiredSignature, setReviewRequiredSignature] = useState("")
  const [isRefreshingQuote, setIsRefreshingQuote] = useState(false)
  // Synchronous: a second click can land before React renders the mutation as pending.
  const busyRef = useRef(false)
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
    enabled: true,
  })
  const headQuery = useSourceChainHead(source.chainId)

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
  const quoteBound =
    transport === "direct" ||
    isQuoteBoundToOptions(quote?.deposit_address, optionsData?.deposit_address)
  // A quote issued for a newer address than the options: re-read the options once per pair.
  const unboundPair =
    quote && optionsData && !quoteBound
      ? `${quote.deposit_address}|${optionsData.deposit_address}`
      : ""
  const refetchOptions = optionsQuery.refetch
  useEffect(() => {
    if (unboundPair) void refetchOptions()
  }, [unboundPair, refetchOptions])
  const boundQuote = quote && quoteBound ? quote : undefined

  const depositAddressQuery = useDepositAddress({
    walletAddress: transport === "direct" ? recipient : "",
    chainId: destination.chain_id,
    assetDenom: destination.denom,
  })
  const depositAddress =
    transport === "direct" ? depositAddressQuery.data?.deposit_address : boundQuote?.deposit_address

  const meetsMinimum =
    transport === "lifi"
      ? !!boundQuote &&
        !!optionsData &&
        meetsRequiredMinimum(
          boundQuote,
          optionsData.required_min_received,
          route.min_deposit_amount,
        )
      : gteInteger(amount, route.min_deposit_amount)
  const minimumLabel = formatSourceMin(route.min_deposit_amount, route.src_decimals, "USDC")

  const quoteBase = {
    srcChainId: ETHEREUM_CHAIN_ID,
    srcDenom: ETHEREUM_USDC_DENOM,
    dstChainId: destination.chain_id,
    dstDenom: destination.denom,
  }
  // The guaranteed amount, not the expected one, must clear the destination.
  const preflightAmount = transport === "lifi" ? (boundQuote?.min_received ?? "") : amount
  const displayAmount = transport === "lifi" ? (boundQuote?.amount_out ?? "") : amount
  const preflightQuery = useQuery(
    createQuoteQueryOptions(api, { ...quoteBase, amountIn: preflightAmount }, !!preflightAmount),
  )
  const needsDisplayQuote = !!displayAmount && displayAmount !== preflightAmount
  const displayQuery = useQuery(
    createQuoteQueryOptions(api, { ...quoteBase, amountIn: displayAmount }, needsDisplayQuote),
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
  const delivery = deliverySeconds(displayQuote, destination)
  const estimatedSeconds = combineEstimatedSeconds(
    transport === "lifi" ? [boundQuote?.estimate.execution_duration_seconds, delivery] : [delivery],
  )

  const approval = boundQuote?.approval
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
      readAllowance(getPinnedProvider(source.chainId), {
        owner: hexAddress,
        token: source.denom,
        spender,
      }),
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

  const quoteSignature = boundQuote ? bridgeQuoteSignature(boundQuote) : ""
  const quoteUpdated = !!reviewRequiredSignature && reviewRequiredSignature === quoteSignature

  const sourceLeg = {
    name: source.chainName,
    logoUrl: findChain(source.chainId)?.logo_uri || source.fallbackChainLogoUrl,
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
    const issued = transport === "direct" ? depositAddressQuery.data : quote
    const depositAddress = issued?.deposit_address
    const cursor = issued?.cursor ?? ""
    if (!recipient || !hexAddress || !amount || !depositAddress || !cursor) return undefined
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
      cursor,
      transaction,
      predictedDelivery: displayQuote?.delivery?.method,
    }
  }
  const draftTransaction = buildDraft(boundQuote)?.transaction

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
    await switchEthereumChain(provider, chain)
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
      } catch (error) {
        throw await normalizeError(error)
      }
    },
    onSuccess: () => {
      // A fresh quote may carry a different spender or amount.
      void queryClient.invalidateQueries({ queryKey: quoteQueryOptions.queryKey })
      void queryClient.invalidateQueries({ queryKey: allowanceKey })
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
    if (!draft) throw new Error("This deposit is not ready to send")

    // A rejected prompt or a remount reuses the form's record while it is still re-signable.
    const storedId = getValues("depositSessionId")
    const stored = storedId ? readDepositSession(localStorage, storedId) : null
    // Written and read back before any wallet prompt, the chain switch included.
    const prepared = writeDepositSession(localStorage, {
      ...reuseOrCreateDepositSession(stored, draft),
      ...draft,
      phase: "prepared",
      updatedAt: Date.now(),
    })
    setValue("depositSessionId", prepared.id)

    const signer = await getSigner(prepared.transaction.chainId)
    writeDepositSession(localStorage, {
      ...prepared,
      phase: "send_prompt",
      preSubmitBlock: headQuery.data?.block,
      updatedAt: Date.now(),
    })

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
      if (isProvablyNotSent(message)) {
        rollbackDepositSessionPrompt(localStorage, prepared.id)
        throw error
      }
      const hash = sendTransactionHashOf(error)
      if (!hash) {
        writeAfterPrompt({ ...prepared, phase: "submission_unknown" })
        throw new UnknownSendError(message)
      }
      response = { hash, from: hexAddress }
    }

    writeAfterPrompt({
      ...prepared,
      phase: "source_sent",
      submitted: { nonce: response.nonce, from: response.from },
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
    isAmountSettled: toBaseUnitString(quantity, source.decimals) === amount,
    amount,
    balancesError: !!balancesQuery.error,
    tokenBalance: balancesQuery.data?.token,
    nativeBalance: balancesQuery.data?.native,
    requiredNative: requiredNativeAmount({
      value: draftTransaction?.value,
      gasLimit: draftTransaction?.gasLimit,
      maxFeePerGas: headQuery.data?.maxFeePerGas,
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

  // Only an unchanged re-read may go on to the wallet in the same click.
  const refreshQuote = async (): Promise<BridgeQuoteResponse | undefined> => {
    setIsRefreshingQuote(true)
    try {
      const { data, isError } = await quoteQuery.refetch()
      if (!mountedRef.current) return undefined
      const verified =
        !isError &&
        data &&
        isQuoteBoundToOptions(data.deposit_address, optionsData?.deposit_address)
          ? data
          : undefined
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
    if (busyRef.current || readiness.status !== "ready") return
    busyRef.current = true
    let locked = false
    try {
      let reviewed = boundQuote
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

  const approve = async () => {
    if (busyRef.current || !approval) return
    busyRef.current = true
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
    quote: boundQuote,
    estimatedAmountOut: displayQuote?.amount_out,
    estimatedSeconds,
    approval: {
      required: approvalRequired,
      isChecking: approvalChecking,
      isApproving: approveMutation.isPending,
      error: approveMutation.error?.message,
      approve: approvalRequired ? approve : undefined,
    },
    readiness,
    submit,
    isSubmitting: sendMutation.isPending || isRefreshingQuote,
    submitError,
    nativeSymbol: "ETH",
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
