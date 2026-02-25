import { encodeSecp256k1Pubkey } from "@cosmjs/amino"
import type { EncodeObject } from "@cosmjs/proto-signing"
import type { DeliverTxResponse, SigningStargateClient, StdFee } from "@cosmjs/stargate"
import {
  calculateFee,
  createProtobufRpcClient,
  GasPrice,
  QueryClient,
  setupTxExtension,
} from "@cosmjs/stargate"
import type { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin"
import { SignMode } from "cosmjs-types/cosmos/tx/signing/v1beta1/signing"
import { ServiceClientImpl, SimulateRequest } from "cosmjs-types/cosmos/tx/v1beta1/service"
import { AuthInfo, Fee, Tx, TxBody, TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx"
import type { Any } from "cosmjs-types/google/protobuf/any"
import { atom, useAtomValue, useSetAtom } from "jotai"
import { useNavigate } from "@/lib/router"
import type { DerivedWalletPublic } from "@/pages/autosign/data/store"
import { useValidateAutoSign } from "@/pages/autosign/data/validation"
import {
  buildAuthzExecMessages,
  signWithDerivedWalletWithPrivateKey,
  useDeriveWallet,
} from "@/pages/autosign/data/wallet"
import { useModal } from "@/public/app/ModalContext"
import { DEFAULT_GAS_ADJUSTMENT } from "@/public/data/constants"
import { useInitiaAddress } from "@/public/data/hooks"
import { encodeEthSecp256k1Pubkey } from "./patches/encoding"
import { encodePubkeyInitia } from "./patches/pubkeys"
import { useAnalyticsTrack } from "./analytics"
import { useFindChain } from "./chains"
import { useConfig } from "./config"
import { formatMoveError } from "./errors"
import { fetchGasPrices } from "./fee"
import {
  resolveSignerAccountSequence,
  useCreateComet38Client,
  useCreateSigningStargateClient,
  useOfflineSigner,
  useRegistry,
  useSignWithEthSecp256k1,
} from "./signer"
import { useDrawer } from "./ui"

export interface TxParams {
  messages: EncodeObject[]
  memo?: string
  chainId?: string
  fee: StdFee
  preferredFeeDenom?: string
}

export interface TxRequest {
  messages: EncodeObject[]
  memo?: string
  chainId?: string
  gas?: number
  gasAdjustment?: number
  gasPrices?: Coin[] | null
  spendCoins?: Coin[]

  /** Internal use only */
  internal?: boolean | string | number // number for disabling notification
}

interface TxRequestHandler {
  txRequest: Required<TxRequest>
  resolve: (signedTx: TxRaw) => Promise<void>
  reject: (error: Error) => void
}

export interface TxStatus {
  status: "loading" | "success" | "error"
  chainId: string
  txHash?: string
  error?: Error
}

export const TX_APPROVAL_MUTATION_KEY = "approve"
export const txRequestHandlerAtom = atom<TxRequestHandler>()
export const txStatusAtom = atom<TxStatus | null>(null)

const DEFAULT_AUTOSIGN_GAS_MULTIPLIER = DEFAULT_GAS_ADJUSTMENT
const DEFAULT_AUTOSIGN_MAX_GAS_MULTIPLIER = 1.5

interface ResolvedAutoSignFeePolicy {
  gasMultiplier: number
  maxGasMultiplierFromSim: number
  allowedFeeDenoms?: string[]
}

export function selectAutoSignGasPrice({
  gasPrices,
  preferredFeeDenom,
  fallbackFeeDenom,
  allowedFeeDenoms,
}: {
  gasPrices: Coin[]
  preferredFeeDenom?: string
  fallbackFeeDenom?: string
  allowedFeeDenoms?: string[]
}): Coin {
  const filteredGasPrices = allowedFeeDenoms?.length
    ? gasPrices.filter(({ denom }) => allowedFeeDenoms.includes(denom))
    : gasPrices

  if (filteredGasPrices.length === 0) {
    throw new Error("No allowed gas price tokens available for auto-sign")
  }

  const findDenom = (denom?: string) =>
    denom ? filteredGasPrices.find((price) => price.denom === denom) : undefined

  return findDenom(preferredFeeDenom) ?? findDenom(fallbackFeeDenom) ?? filteredGasPrices[0]!
}

export function buildAutoSignFeeFromSimulation({
  simulatedGas,
  gasPrices,
  preferredFeeDenom,
  fallbackFeeDenom,
  policy,
}: {
  simulatedGas: number
  gasPrices: Coin[]
  preferredFeeDenom?: string
  fallbackFeeDenom?: string
  policy: ResolvedAutoSignFeePolicy
}): StdFee {
  if (!Number.isFinite(simulatedGas) || simulatedGas <= 0) {
    throw new Error("Auto-sign gas simulation failed")
  }

  const { gasMultiplier, maxGasMultiplierFromSim, allowedFeeDenoms } = policy
  if (
    gasMultiplier <= 0 ||
    maxGasMultiplierFromSim <= 0 ||
    gasMultiplier > maxGasMultiplierFromSim
  ) {
    throw new Error("Invalid auto-sign gas multiplier policy")
  }

  const gasLimit = Math.ceil(simulatedGas * gasMultiplier)

  const gasPrice = selectAutoSignGasPrice({
    gasPrices,
    preferredFeeDenom,
    fallbackFeeDenom,
    allowedFeeDenoms,
  })

  return calculateFee(gasLimit, GasPrice.fromString(`${gasPrice.amount}${gasPrice.denom}`))
}

interface AutoSignSimulationInput {
  messages: EncodeObject[]
}

export function buildAutoSignSimulationInput({
  derivedAddress,
  messages,
  encoder,
}: {
  derivedAddress: string
  messages: EncodeObject[]
  encoder: { encode: (message: EncodeObject) => Uint8Array }
}): AutoSignSimulationInput {
  return {
    messages: buildAuthzExecMessages({
      granteeAddress: derivedAddress,
      messages,
      encoder,
    }),
  }
}

interface SignTxWithAutoSignFeeParams {
  address: string
  chainId: string
  messages: EncodeObject[]
  memo: string
  fee: StdFee
  preferredFeeDenom?: string
  client?: SigningStargateClient
  allowAutoSign?: boolean
  allowWalletDerivation?: boolean
}

interface ComputeAutoSignFeeParams {
  chainId: string
  messages: EncodeObject[]
  memo: string
  derivedWallet: DerivedWalletPublic
  preferredFeeDenom?: string
  fallbackFeeDenom?: string
  client: SigningStargateClient
}

type AutoSignFallbackReason =
  | "validation_failed"
  | "derive_wallet_failed"
  | "missing_derived_wallet"
  | "fee_computation_failed"
  | "derived_wallet_sign_failed"

interface SignTxWithAutoSignFeeDeps {
  validateAutoSign: (chainId: string, messages: EncodeObject[]) => boolean
  getWallet: (chainId: string) => DerivedWalletPublic | undefined
  deriveWallet: (chainId: string) => Promise<DerivedWalletPublic>
  getSigningClient: (chainId: string) => Promise<SigningStargateClient>
  computeAutoSignFee: (params: ComputeAutoSignFeeParams) => Promise<StdFee>
  signWithDerivedWallet: (
    chainId: string,
    granterAddress: string,
    messages: EncodeObject[],
    fee: StdFee,
    memo: string,
    derivedWalletOverride?: DerivedWalletPublic,
  ) => Promise<TxRaw>
  signWithEthSecp256k1: (
    chainId: string,
    signerAddress: string,
    messages: EncodeObject[],
    fee: StdFee,
    memo: string,
  ) => Promise<TxRaw>
  onAutoSignFallback?: (params: {
    chainId: string
    reason: AutoSignFallbackReason
    errorMessage?: string
  }) => void
}

function isUserRejectedRequestError(error: unknown): boolean {
  if (!(error instanceof Error)) return false

  const normalizedMessage = error.message.toLowerCase()
  const maybeCode = (
    error as Error & {
      code?: string | number
      cause?: { code?: string | number; message?: string }
    }
  ).code
  const maybeCauseCode = (
    error as Error & {
      cause?: { code?: string | number; message?: string }
    }
  ).cause?.code

  const isUserRejectedMessage =
    normalizedMessage.includes("user rejected") ||
    normalizedMessage.includes("rejected the request") ||
    normalizedMessage.includes("user denied") ||
    normalizedMessage.includes("denied by user") ||
    normalizedMessage.includes("user cancelled") ||
    normalizedMessage.includes("user canceled") ||
    normalizedMessage.includes("cancelled by user") ||
    normalizedMessage.includes("canceled by user")

  return (
    maybeCode === 4001 ||
    maybeCode === "ACTION_REJECTED" ||
    maybeCauseCode === 4001 ||
    maybeCauseCode === "ACTION_REJECTED" ||
    isUserRejectedMessage
  )
}

async function simulateWithCustomPubkey({
  queryClient,
  messages,
  memo,
  pubkey,
  sequence,
}: {
  queryClient: QueryClient
  messages: readonly Any[]
  memo?: string
  pubkey: Any
  sequence: number
}) {
  const rpcClient = createProtobufRpcClient(queryClient)
  const queryService = new ServiceClientImpl(rpcClient)

  const tx = Tx.fromPartial({
    authInfo: AuthInfo.fromPartial({
      fee: Fee.fromPartial({}),
      signerInfos: [
        {
          publicKey: pubkey,
          sequence: BigInt(sequence),
          modeInfo: { single: { mode: SignMode.SIGN_MODE_UNSPECIFIED } },
        },
      ],
    }),
    body: TxBody.fromPartial({
      messages: Array.from(messages),
      memo,
    }),
    signatures: [new Uint8Array()],
  })

  return await queryService.Simulate(
    SimulateRequest.fromPartial({
      txBytes: Tx.encode(tx).finish(),
    }),
  )
}

function getFallbackErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return undefined
}

export async function signTxWithAutoSignFeeWithDeps(
  {
    address,
    chainId,
    messages,
    memo,
    fee,
    preferredFeeDenom,
    client,
    allowAutoSign = true,
    allowWalletDerivation = false,
  }: SignTxWithAutoSignFeeParams,
  deps: SignTxWithAutoSignFeeDeps,
): Promise<TxRaw> {
  const signManually = async () => deps.signWithEthSecp256k1(chainId, address, messages, fee, memo)
  const reportFallback = (reason: AutoSignFallbackReason, error?: unknown) => {
    deps.onAutoSignFallback?.({
      chainId,
      reason,
      errorMessage: getFallbackErrorMessage(error),
    })
  }

  if (!allowAutoSign) {
    return signManually()
  }

  const isAutoSignValid = deps.validateAutoSign(chainId, messages)
  if (!isAutoSignValid) {
    reportFallback("validation_failed")
    return signManually()
  }

  let derivedWallet = deps.getWallet(chainId)
  let hasReportedDeriveFailure = false
  if (!derivedWallet && allowWalletDerivation) {
    try {
      derivedWallet = await deps.deriveWallet(chainId)
    } catch (error) {
      if (isUserRejectedRequestError(error)) {
        throw error
      }
      reportFallback("derive_wallet_failed", error)
      hasReportedDeriveFailure = true
      derivedWallet = undefined
    }
  }

  if (!derivedWallet) {
    // Skip auto-sign if no derived wallet is cached to avoid unexpected wallet popups.
    if (!hasReportedDeriveFailure) {
      reportFallback("missing_derived_wallet")
    }
    return signManually()
  }

  let signingFee: StdFee
  try {
    const signingClient = client ?? (await deps.getSigningClient(chainId))
    signingFee = await deps.computeAutoSignFee({
      chainId,
      messages,
      memo,
      derivedWallet,
      preferredFeeDenom,
      fallbackFeeDenom: fee.amount[0]?.denom,
      client: signingClient,
    })
  } catch (error) {
    reportFallback("fee_computation_failed", error)
    return signManually()
  }

  try {
    return await deps.signWithDerivedWallet(
      chainId,
      address,
      messages,
      signingFee,
      memo,
      derivedWallet,
    )
  } catch (error) {
    reportFallback("derived_wallet_sign_failed", error)
    return signManually()
  }
}

export function useSignTxWithAutoSignFee() {
  const address = useInitiaAddress()
  const { autoSignFeePolicy } = useConfig()
  const findChain = useFindChain()
  const createComet38Client = useCreateComet38Client()
  const createSigningStargateClient = useCreateSigningStargateClient()
  const registry = useRegistry()
  const validateAutoSign = useValidateAutoSign()
  const { getWallet, deriveWallet, getWalletPrivateKey } = useDeriveWallet()
  const signWithEthSecp256k1 = useSignWithEthSecp256k1()
  const track = useAnalyticsTrack()

  const getAutoSignFeePolicy = (chainId: string): ResolvedAutoSignFeePolicy => {
    const policy = autoSignFeePolicy?.[chainId]
    return {
      gasMultiplier: policy?.gasMultiplier ?? DEFAULT_AUTOSIGN_GAS_MULTIPLIER,
      maxGasMultiplierFromSim:
        policy?.maxGasMultiplierFromSim ?? DEFAULT_AUTOSIGN_MAX_GAS_MULTIPLIER,
      allowedFeeDenoms: policy?.allowedFeeDenoms,
    }
  }

  const computeAutoSignFee = async ({
    chainId,
    messages,
    memo,
    derivedWallet,
    preferredFeeDenom,
    fallbackFeeDenom,
    client,
  }: {
    chainId: string
    messages: EncodeObject[]
    memo: string
    derivedWallet: {
      address: string
      publicKey: Uint8Array
    }
    preferredFeeDenom?: string
    fallbackFeeDenom?: string
    client: SigningStargateClient
  }): Promise<StdFee> => {
    const chain = findChain(chainId)
    const gasPrices = await fetchGasPrices(chain)

    const simulationInput = buildAutoSignSimulationInput({
      derivedAddress: derivedWallet.address,
      messages,
      encoder: registry,
    })
    const anyMessages = simulationInput.messages.map((msg) => registry.encodeAsAny(msg))
    const pubkey = encodePubkeyInitia(encodeEthSecp256k1Pubkey(derivedWallet.publicKey))

    const { sequence } = await resolveSignerAccountSequence({
      getSequence: (address) => client.getSequence(address),
      signerAddress: derivedWallet.address,
      incrementSequence: 0,
      allowMissingAccount: true,
    })

    const cometClient = await createComet38Client(chainId)
    const queryClient = QueryClient.withExtensions(cometClient, setupTxExtension)
    const { gasInfo } = await simulateWithCustomPubkey({
      queryClient,
      messages: anyMessages,
      memo,
      pubkey,
      sequence,
    })
    const simulatedGas = gasInfo ? Number(gasInfo.gasUsed.toString()) : 0
    const policy = getAutoSignFeePolicy(chainId)

    return buildAutoSignFeeFromSimulation({
      simulatedGas,
      gasPrices,
      preferredFeeDenom,
      fallbackFeeDenom,
      policy,
    })
  }

  const signWithDerivedWallet: SignTxWithAutoSignFeeDeps["signWithDerivedWallet"] = async (
    chainId,
    granterAddress,
    messages,
    fee,
    memo,
    derivedWalletOverride,
  ) => {
    let derivedWallet = derivedWalletOverride ?? getWallet(chainId)
    if (!derivedWallet) {
      derivedWallet = await deriveWallet(chainId)
    }

    const privateKey = getWalletPrivateKey(chainId)
    if (!privateKey) {
      throw new Error("Derived wallet key not initialized")
    }

    return await signWithDerivedWalletWithPrivateKey({
      chainId,
      granterAddress,
      messages,
      fee,
      memo,
      derivedWallet,
      privateKey,
      encoder: registry,
      signWithEthSecp256k1,
    })
  }

  return (params: Omit<SignTxWithAutoSignFeeParams, "address">): Promise<TxRaw> =>
    signTxWithAutoSignFeeWithDeps(
      {
        ...params,
        address,
      },
      {
        validateAutoSign,
        getWallet,
        deriveWallet,
        getSigningClient: createSigningStargateClient,
        computeAutoSignFee,
        signWithDerivedWallet,
        signWithEthSecp256k1,
        onAutoSignFallback: ({ chainId, reason, errorMessage }) => {
          track("AutoSign Fallback", {
            chainId,
            reason,
            errorMessage,
          })
        },
      },
    )
}

export function useTxRequestHandler() {
  const txRequest = useAtomValue(txRequestHandlerAtom)
  if (!txRequest) throw new Error("Tx request not found")
  return txRequest
}

export function useTx() {
  const navigate = useNavigate()
  const address = useInitiaAddress()
  const { defaultChainId, registryUrl } = useConfig()
  const findChain = useFindChain()
  const { openDrawer, closeDrawer } = useDrawer()
  const { openModal, closeModal } = useModal()
  const setTxRequestHandler = useSetAtom(txRequestHandlerAtom)
  const setTxStatus = useSetAtom(txStatusAtom)
  const createComet38Client = useCreateComet38Client()
  const createSigningStargateClient = useCreateSigningStargateClient()
  const offlineSigner = useOfflineSigner()
  const registry = useRegistry()
  const signTxWithAutoSignFee = useSignTxWithAutoSignFee()

  const estimateGas = async ({ messages, memo, chainId = defaultChainId }: TxRequest) => {
    try {
      const client = await createSigningStargateClient(chainId)
      return await client.simulate(address, messages, memo)
    } catch (error) {
      throw await formatMoveError(error as Error, findChain(chainId), registryUrl)
    }
  }

  const simulateTx = async ({ messages, memo, chainId = defaultChainId }: TxRequest) => {
    const cometClient = await createComet38Client(chainId)
    const queryClient = QueryClient.withExtensions(cometClient, setupTxExtension)
    const anyMsgs = messages.map((msg) => registry.encodeAsAny(msg))
    const [account] = await offlineSigner.getAccounts()
    const pubkey = encodeSecp256k1Pubkey(account.pubkey)
    const client = await createSigningStargateClient(chainId)
    const { sequence } = await client.getSequence(address)
    return queryClient.tx.simulate(anyMsgs, memo, pubkey, sequence)
  }

  type Broadcaster<T> = (client: SigningStargateClient, signedTxBytes: Uint8Array) => Promise<T>
  const requestTx = async <T>({
    txRequest: rawTxRequest,
    broadcaster,
  }: {
    txRequest: TxRequest
    broadcaster: Broadcaster<T>
  }): Promise<T> => {
    // Fill unspecified fields with sane defaults so that the rest of the
    // request logic can assume they exist.
    const defaultTxRequest = {
      memo: "",
      chainId: defaultChainId,
      gas: rawTxRequest.gas || (await estimateGas(rawTxRequest)),
      gasAdjustment: DEFAULT_GAS_ADJUSTMENT,
      gasPrices: null,
      spendCoins: [],
      internal: false,
    }

    const txRequest = { ...defaultTxRequest, ...rawTxRequest }

    return new Promise<T>((resolve, reject) => {
      setTxRequestHandler({
        txRequest,
        resolve: async (signedTx: TxRaw) => {
          try {
            const client = await createSigningStargateClient(txRequest.chainId)
            const response = await broadcaster(client, TxRaw.encode(signedTx).finish())
            resolve(response)
            if (typeof txRequest.internal === "string") {
              // Internal requests can redirect to a different route after signing.
              navigate(txRequest.internal)
            }
          } catch (error) {
            reject(await formatMoveError(error as Error, findChain(txRequest.chainId), registryUrl))
          } finally {
            finalize()
          }
        },
        reject: (error: Error) => {
          reject(error)
          finalize()
        },
      })

      // Show the signing UI. External callers open a drawer while internal
      // operations use a modal so the host app remains unaffected.
      if (!txRequest.internal) {
        openDrawer("/tx")
      } else {
        openModal({ path: "/tx" })
      }

      // Cleanup after the request resolves or rejects.
      const finalize = () => {
        if (!txRequest.internal) {
          navigate("/blank")
          closeDrawer()
          return
        }

        closeModal()
      }
    })
  }

  const requestTxSync = async (txRequest: TxRequest) => {
    const chainId = txRequest.chainId ?? defaultChainId

    try {
      const txHash = await requestTx<string>({
        txRequest,
        broadcaster: async (client, signedTxBytes) => {
          const transactionHash = await client.broadcastTxSync(signedTxBytes)
          return transactionHash
        },
      })

      if (txRequest.internal && typeof txRequest.internal !== "number") {
        // For internal calls we show the transaction status inside the widget.
        // Update state while waiting for the confirmation to arrive.
        setTxStatus({ txHash, chainId, status: "loading" })
        waitForTxConfirmation({ txHash, chainId: txRequest.chainId })
          .then((tx) => {
            setTxStatus({ status: tx.code === 0 ? "success" : "error", chainId, txHash })
          })
          .catch(() => {
            setTxStatus({ status: "error", chainId, txHash })
          })
      }

      return txHash
    } catch (error) {
      if (txRequest.internal && typeof txRequest.internal !== "number") {
        setTxStatus({ status: "error", chainId, error: error as Error })
      }
      throw error
    }
  }

  const requestTxBlock = (txRequest: TxRequest, timeoutMs = 30 * 1000, intervalMs = 0.5 * 1000) => {
    return requestTx<DeliverTxResponse>({
      txRequest,
      broadcaster: async (client, signedTxBytes) => {
        const response = await client.broadcastTx(signedTxBytes, timeoutMs, intervalMs)
        if (response.code !== 0) throw new Error(response.rawLog)
        return response
      },
    })
  }

  const signTxForSubmission = async ({
    chainId,
    messages,
    memo = "",
    fee,
    preferredFeeDenom,
  }: {
    chainId: string
    messages: EncodeObject[]
    memo?: string
    fee: StdFee
    preferredFeeDenom?: string
  }) => {
    const client = await createSigningStargateClient(chainId)
    const signedTx = await signTxWithAutoSignFee({
      chainId,
      messages,
      memo,
      fee,
      preferredFeeDenom,
      client,
      // Re-derive once per page session when auto-sign is enabled so direct
      // signing continues to work after reload.
      allowWalletDerivation: true,
    })

    return { client, signedTx }
  }

  const submitTxSync = async (txParams: TxParams): Promise<string> => {
    const chainId = txParams.chainId ?? defaultChainId
    try {
      const { client, signedTx } = await signTxForSubmission({
        ...txParams,
        chainId,
      })

      return await client.broadcastTxSync(TxRaw.encode(signedTx).finish())
    } catch (error) {
      throw await formatMoveError(error as Error, findChain(chainId), registryUrl)
    }
  }

  const submitTxBlock = async (
    txParams: TxParams,
    timeoutMs = 30 * 1000,
    intervalMs = 0.5 * 1000,
  ): Promise<DeliverTxResponse> => {
    const chainId = txParams.chainId ?? defaultChainId
    try {
      const { client, signedTx } = await signTxForSubmission({
        ...txParams,
        chainId,
      })

      const response = await client.broadcastTx(
        TxRaw.encode(signedTx).finish(),
        timeoutMs,
        intervalMs,
      )
      if (response.code !== 0) throw new Error(response.rawLog)
      return response
    } catch (error) {
      throw await formatMoveError(error as Error, findChain(chainId), registryUrl)
    }
  }

  const waitForTxConfirmation = async ({
    chainId = defaultChainId,
    ...params
  }: {
    txHash: string
    chainId?: string
    timeoutMs?: number
    intervalMs?: number
  }) => {
    try {
      const client = await createSigningStargateClient(chainId)
      return await waitForTxConfirmationWithClient({ ...params, client })
    } catch (error) {
      throw await formatMoveError(error as Error, findChain(chainId), registryUrl)
    }
  }

  return {
    estimateGas,
    simulateTx,
    requestTxSync,
    requestTxBlock,
    submitTxSync,
    submitTxBlock,
    waitForTxConfirmation,
  }
}

export async function waitForTxConfirmationWithClient({
  txHash,
  client,
  timeoutMs = 30 * 1000,
  intervalMs = 0.5 * 1000,
}: {
  txHash: string
  client: SigningStargateClient
  timeoutMs?: number
  intervalMs?: number
}) {
  const start = Date.now()

  while (true) {
    const tx = await client.getTx(txHash)

    if (tx) {
      if (tx.code !== 0) throw new Error(tx.rawLog)
      return tx
    }

    if (Date.now() - start >= timeoutMs) {
      throw new Error(
        `Transaction was submitted, but not found on the chain within ${timeoutMs / 1000} seconds.`,
      )
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}
