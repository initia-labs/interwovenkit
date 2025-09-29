import type { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin"
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx"
import { encodeSecp256k1Pubkey } from "@cosmjs/amino"
import type { EncodeObject } from "@cosmjs/proto-signing"
import type { DeliverTxResponse, SigningStargateClient, StdFee } from "@cosmjs/stargate"
import { QueryClient, setupTxExtension } from "@cosmjs/stargate"
import { atom, useAtomValue, useSetAtom } from "jotai"
import { useNavigate } from "@/lib/router"
import { DEFAULT_GAS_ADJUSTMENT } from "@/public/data/constants"
import { useInitiaAddress } from "@/public/data/hooks"
import { useModal } from "@/public/app/ModalContext"
import { useConfig } from "./config"
import { formatMoveError } from "./errors"
import { useFindChain } from "./chains"
import {
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

  const requestTxBlock = (txRequest: TxRequest) => {
    return requestTx<DeliverTxResponse>({
      txRequest,
      broadcaster: async (client, signedTxBytes) => {
        const response = await client.broadcastTx(signedTxBytes)
        if (response.code !== 0) throw new Error(response.rawLog)
        return response
      },
    })
  }

  const signWithEthSecp256k1 = useSignWithEthSecp256k1()

  const submitTxSync = async (txParams: TxParams) => {
    const { messages, memo = "", chainId = defaultChainId, fee } = txParams
    const client = await createSigningStargateClient(chainId)
    const signedTx = await signWithEthSecp256k1(chainId, address, messages, fee, memo)
    const response = await client.broadcastTxSync(TxRaw.encode(signedTx).finish())
    return response
  }

  const submitTxBlock = async (txParams: TxParams) => {
    const { messages, memo = "", chainId = defaultChainId, fee } = txParams
    const client = await createSigningStargateClient(chainId)
    const signedTx = await signWithEthSecp256k1(chainId, address, messages, fee, memo)
    const response = await client.broadcastTx(TxRaw.encode(signedTx).finish())
    return response
  }

  const waitForTxConfirmation = async ({
    chainId = defaultChainId,
    ...params
  }: {
    txHash: string
    chainId?: string
    timeoutSeconds?: number
    intervalSeconds?: number
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
  timeoutSeconds = 30,
  intervalSeconds = 1,
}: {
  txHash: string
  client: SigningStargateClient
  timeoutSeconds?: number
  intervalSeconds?: number
}) {
  const start = Date.now()
  const timeoutMs = timeoutSeconds * 1000

  while (true) {
    const tx = await client.getTx(txHash)

    if (tx) {
      if (tx.code !== 0) throw new Error(tx.rawLog)
      return tx
    }

    if (Date.now() - start >= timeoutMs) {
      throw new Error(
        `Transaction was submitted, but not found on the chain within ${timeoutSeconds} seconds.`,
      )
    }

    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000))
  }
}
