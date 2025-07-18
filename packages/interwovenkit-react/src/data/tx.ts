import ky from "ky"
import { descend } from "ramda"
import BigNumber from "bignumber.js"
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx"
import { useSuspenseQuery } from "@tanstack/react-query"
import { fromBase64 } from "@cosmjs/encoding"
import type { Coin, EncodeObject } from "@cosmjs/proto-signing"
import {
  GasPrice,
  type DeliverTxResponse,
  type SigningStargateClient,
  type StdFee,
} from "@cosmjs/stargate"
import { atom, useAtomValue, useSetAtom } from "jotai"
import { useNavigate } from "@/lib/router"
import { DEFAULT_GAS_ADJUSTMENT, DEFAULT_GAS_PRICE_MULTIPLIER } from "@/public/data/constants"
import { useInitiaAddress } from "@/public/data/hooks"
import { useModal } from "@/public/app/ModalContext"
import { AddressUtils } from "@/public/utils"
import { useConfig } from "./config"
import { normalizeError, STALE_TIMES } from "./http"
import { useCreateSigningStargateClient } from "./signer"
import { useDrawer } from "./ui"
import { chainQueryKeys, type NormalizedChain } from "./chains"
import { type TxItem } from "@/pages/wallet/tabs/activity/data"
import type { Paginated } from "./pagination"

export interface TxRequest {
  messages: EncodeObject[]
  memo?: string
  chainId?: string
  gasAdjustment?: number
  gas?: number
  fee?: StdFee | null
  feeOptions?: StdFee[] | null

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
  const { defaultChainId } = useConfig()
  const { openDrawer, closeDrawer } = useDrawer()
  const { openModal, closeModal } = useModal()
  const setTxRequestHandler = useSetAtom(txRequestHandlerAtom)
  const setTxStatus = useSetAtom(txStatusAtom)
  const createSigningStargateClient = useCreateSigningStargateClient()

  const estimateGas = async ({ messages, memo, chainId = defaultChainId }: TxRequest) => {
    try {
      const client = await createSigningStargateClient(chainId)
      return await client.simulate(address, messages, memo)
    } catch (error) {
      throw new Error(await normalizeError(error))
    }
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
      fee: null,
      feeOptions: null,
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
            reject(error)
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

  const waitForTxConfirmation = async ({
    chainId = defaultChainId,
    ...params
  }: {
    txHash: string
    chainId?: string
    timeoutSeconds?: number
    intervalSeconds?: number
  }) => {
    const client = await createSigningStargateClient(chainId)
    return waitForTxConfirmationWithClient({ ...params, client })
  }

  return { estimateGas, requestTxSync, requestTxBlock, waitForTxConfirmation }
}

export function useGasPrices(chain: NormalizedChain) {
  const { data } = useSuspenseQuery({
    queryKey: chainQueryKeys.gasPrices(chain).queryKey,
    queryFn: async () => {
      if (chain.metadata?.is_l1) {
        const { restUrl } = chain
        const { gas_prices } = await ky
          .create({ prefixUrl: restUrl })
          .get("initia/tx/v1/gas_prices")
          .json<{ gas_prices: Coin[] }>()
        return gas_prices
          .toSorted(descend(({ denom }) => denom === "uinit"))
          .map(({ denom, amount }) => {
            const price = BigNumber(amount).times(DEFAULT_GAS_PRICE_MULTIPLIER).toFixed(18)
            return GasPrice.fromString(price + denom)
          })
      }
      return chain.fees.fee_tokens.map(({ denom, fixed_min_gas_price }) =>
        GasPrice.fromString(fixed_min_gas_price + denom),
      )
    },
    staleTime: STALE_TIMES.MINUTE,
  })

  return data
}

export function useLastFeeDenom(chain: NormalizedChain) {
  const address = useInitiaAddress()

  const { data } = useSuspenseQuery({
    queryKey: chainQueryKeys.lastTx(chain, address).queryKey,
    queryFn: async () => {
      if (chain.fees.fee_tokens.length === 1) {
        return chain.fees.fee_tokens[0].denom
      }

      const result = await ky
        .create({ prefixUrl: chain.indexerUrl })
        .get(`indexer/tx/v1/txs/by_account/${address}`, {
          searchParams: {
            "pagination.key": "",
            "pagination.reverse": true,
          },
        })
        .json<Paginated<"txs", TxItem>>()

      const lastSignedTx = result.txs.find(({ tx }) =>
        tx.auth_info.signer_infos.some(
          (info) => AddressUtils.fromPublicKey(fromBase64(info.public_key.key)) === address,
        ),
      )

      return lastSignedTx?.tx.auth_info.fee.amount[0]?.denom || null
    },
    staleTime: STALE_TIMES.MINUTE,
  })

  return data
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
