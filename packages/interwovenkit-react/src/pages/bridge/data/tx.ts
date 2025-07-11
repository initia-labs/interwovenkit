import { has, head } from "ramda"
import BigNumber from "bignumber.js"
import { AuthInfo, Tx, TxBody } from "cosmjs-types/cosmos/tx/v1beta1/tx"
import { toBase64 } from "@cosmjs/encoding"
import { calculateFee, GasPrice, SigningStargateClient } from "@cosmjs/stargate"
import { createElement, Fragment } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { StatusResponseJson, TrackResponseJson, TxJson } from "@skip-go/client"
import { aminoConverters, aminoTypes } from "@initia/amino-converter"
import { Link, useLocationState, useNavigate } from "@/lib/router"
import { DEFAULT_GAS_ADJUSTMENT } from "@/public/data/constants"
import { AddressUtils } from "@/public/utils"
import { useNotification } from "@/public/app/NotificationContext"
import { useInitiaAddress, useInterwovenKit } from "@/public/data/hooks"
import { normalizeError, STALE_TIMES } from "@/data/http"
import { useAminoTypes, useGetProvider, useRegistry, useSignWithEthSecp256k1 } from "@/data/signer"
import { waitForTxConfirmationWithClient } from "@/data/tx"
import { useClaimableReminders } from "../op/reminder"
import { skipQueryKeys, useSkip } from "./skip"
import type { FormValues } from "./form"
import { useCosmosWallets } from "./cosmos"
import { waitForAccountCreation } from "./account"
import { useChainType, useFindSkipChain, useSkipChain } from "./chains"
import { useFindSkipAsset } from "./assets"
import type { RouterRouteResponseJson } from "./simulate"
import type { HistoryDetails } from "./history"
import { useBridgeHistoryList } from "./history"
import { switchEthereumChain } from "./evm"

export interface BridgePreviewState {
  route: RouterRouteResponseJson
  values: FormValues
}

export interface SignedOpHook {
  signer: string
  hook: string
}

interface OpHookResponse {
  chain_id: string
  hook: {
    msg_type_url: string
    msg: string
  }[]
}

export function useBridgePreviewState() {
  return useLocationState<BridgePreviewState>()
}

export function useBridgeTx(tx: TxJson) {
  const navigate = useNavigate()
  const { showNotification, updateNotification, hideNotification } = useNotification()
  const { addHistoryItem } = useBridgeHistoryList()

  const { route, values } = useBridgePreviewState()
  const { srcChainId, sender, recipient, cosmosWalletName } = values

  const getProvider = useGetProvider()
  const { requestTxSync, waitForTxConfirmation } = useInterwovenKit()
  const { find } = useCosmosWallets()
  const registry = useRegistry()
  const aminoTypes = useAminoTypes()
  const srcChain = useSkipChain(srcChainId)
  const srcChainType = useChainType(srcChain)
  const findAsset = useFindSkipAsset(srcChainId)
  const queryClient = useQueryClient()

  const { addReminder } = useClaimableReminders()
  return useMutation({
    mutationFn: async () => {
      try {
        if ("cosmos_tx" in tx) {
          if (!tx.cosmos_tx.msgs) throw new Error("Invalid transaction data")
          const messages = tx.cosmos_tx.msgs.map(({ msg_type_url, msg }) => {
            if (!(msg_type_url && msg)) throw new Error("Invalid transaction data")
            // Note: `typeUrl` comes in proto format, but `msg` is in amino format.
            // Weird, but that's how the Skip API responds.
            return aminoTypes.fromAmino({
              type: aminoConverters[msg_type_url].aminoType,
              value: JSON.parse(msg),
            })
          })

          if (srcChainType === "initia") {
            const txHash = await requestTxSync({ messages, chainId: srcChainId, internal: 1 })
            const wait = waitForTxConfirmation({ txHash, chainId: srcChainId })
            return { txHash, wait }
          }

          const provider = find(cosmosWalletName)?.getProvider()
          if (!provider) throw new Error("Wallet not connected")
          const offlineSigner = provider.getOfflineSignerOnlyAmino(srcChainId)
          const client = await SigningStargateClient.connectWithSigner(
            srcChain.rpc,
            offlineSigner,
            { registry, aminoTypes },
          )
          const balances = await client.getAllBalances(sender)
          const availableFeeAsset = srcChain.fee_assets.find((asset) =>
            balances.some(
              (balance) => balance.denom === asset.denom && BigNumber(balance.amount).gt(0),
            ),
          )
          if (!availableFeeAsset) {
            const feeSymbols = srcChain.fee_assets.map((asset) => findAsset(asset.denom).symbol)
            const errorMessage = [
              `Insufficient balance for fees.`,
              `Available fee assets: ${feeSymbols.join(", ")}`,
              `(note: asset symbols may refer to different tokens across chains)`,
            ].join(" ")
            throw new Error(errorMessage)
          }
          const { denom, gas_price } = availableFeeAsset
          if (!gas_price) throw new Error(`Gas price not found for ${denom}`)
          const gas = await client.simulate(sender, messages, "")
          const gasPrice = GasPrice.fromString(gas_price.average + denom)
          const fee = calculateFee(Math.ceil(gas * DEFAULT_GAS_ADJUSTMENT), gasPrice)
          const txHash = await client.signAndBroadcastSync(sender, messages, fee)
          const wait = waitForTxConfirmationWithClient({ txHash, client })
          return { txHash, wait }
        }

        if ("evm_tx" in tx) {
          const { chain_id: chainId, to, value, data } = tx.evm_tx
          const provider = await getProvider()
          const signer = await provider.getSigner()
          await switchEthereumChain(provider, srcChain)
          const response = await signer.sendTransaction({ chainId, to, value, data: `0x${data}` })
          // `wait()` is a getter on the response object. Destructuring breaks
          // its internal binding, so keep the original object intact.
          return { txHash: response.hash, wait: response.wait() }
        }

        throw new Error("Unsupported chain type")
      } catch (error) {
        throw new Error(await normalizeError(error))
      }
    },
    onSuccess: ({ txHash, wait }) => {
      navigate(-1)
      showNotification({
        type: "loading",
        title: "Transaction is pending...",
      })

      wait
        .then(() => {
          const tx = { chainId: srcChainId, txHash }
          const isOpWithdraw = getBridgeType(route) === BridgeType.OP_WITHDRAW
          addHistoryItem(tx, {
            ...tx,
            timestamp: Date.now(),
            route,
            values,
            state: isOpWithdraw ? "success" : undefined,
          })
          updateNotification({
            type: "info",
            title: "Transaction submitted",
            description: createElement(
              Fragment,
              null,
              "Check ",
              createElement(
                Link,
                { to: "/bridge/history", onClick: hideNotification },
                "the activity page",
              ),
              " for transaction status",
            ),
          })
          if (isOpWithdraw) {
            addReminder(tx, {
              ...tx,
              recipient: AddressUtils.toBech32(recipient),
              claimableAt: Date.now() + route.estimated_route_duration_seconds * 1000,
              amount: route.amount_out,
              denom: route.dest_asset_denom,
            })
          }
        })
        .catch((error) => {
          updateNotification({
            type: "error",
            title: "Transaction failed",
            description: error.message,
          })
        })
        .finally(() => {
          queryClient.invalidateQueries({
            queryKey: skipQueryKeys.balances(srcChainId, sender).queryKey,
          })
        })
    },
    onError: (error) => {
      showNotification({
        type: "error",
        title: "Transaction failed",
        description: error.message,
      })
    },
  })
}

export function useSignOpHook() {
  const skip = useSkip()
  const initiaAddress = useInitiaAddress()
  const signWithEthSecp256k1 = useSignWithEthSecp256k1()
  const { route, values } = useBridgePreviewState()
  const findSkipChain = useFindSkipChain()

  return useMutation({
    mutationFn: async () => {
      try {
        const { chain_id, hook } = await skip
          .post("op-hook", {
            json: {
              source_address: initiaAddress,
              source_asset_chain_id: route.source_asset_chain_id,
              source_asset_denom: route.source_asset_denom,
              dest_address: values.recipient,
              dest_asset_chain_id: route.dest_asset_chain_id,
              dest_asset_denom: route.dest_asset_denom,
            },
          })
          .json<OpHookResponse>()

        await waitForAccountCreation(initiaAddress, findSkipChain(route.dest_asset_chain_id).rest)

        const messages = hook.map(({ msg_type_url, msg }) => {
          // Note: `typeUrl` comes in proto format, but `msg` is in amino format.
          // Weird, but that's how the Skip API responds.
          return aminoTypes.fromAmino({
            type: aminoConverters[msg_type_url].aminoType,
            value: JSON.parse(msg),
          })
        })

        const signed = await signWithEthSecp256k1(
          chain_id,
          initiaAddress,
          messages,
          { amount: [], gas: "1" },
          "",
        )

        const tx = Tx.fromPartial({
          body: TxBody.decode(signed.bodyBytes),
          authInfo: AuthInfo.decode(signed.authInfoBytes),
          signatures: signed.signatures,
        })

        return { signer: initiaAddress, hook: toBase64(Tx.encode(tx).finish()) }
      } catch (error) {
        throw new Error(await normalizeError(error))
      }
    },
  })
}

export function useTrackTxQuery(details: HistoryDetails, disabled = false) {
  const { chainId, txHash } = details
  const skip = useSkip()
  return useQuery({
    queryKey: skipQueryKeys.txTrack(chainId, txHash).queryKey,
    queryFn: async () => {
      try {
        return await skip
          .post("v2/tx/track", { json: { tx_hash: txHash, chain_id: chainId } })
          .json<TrackResponseJson>()
      } catch (error) {
        throw new Error(await normalizeError(error))
      }
    },
    select: ({ tx_hash }) => tx_hash,
    retry: 6,
    retryDelay: 10_000,
    staleTime: STALE_TIMES.INFINITY,
    enabled: !disabled,
  })
}

export function useTxStatusQuery(details: HistoryDetails, disabled = false) {
  const { timestamp, chainId, txHash, state } = details
  const skip = useSkip()

  return useQuery({
    queryKey: skipQueryKeys.txStatus(chainId, txHash).queryKey,
    queryFn: () =>
      skip
        .get("v2/tx/status", { searchParams: { tx_hash: txHash, chain_id: chainId } })
        .json<StatusResponseJson>(),
    enabled: !!txHash && !state && !disabled,
    refetchInterval: ({ state: { data } }) => {
      if (!data) return false
      const { status } = data
      if (status === "STATE_COMPLETED") return false

      const eta = timestamp + details.route.estimated_route_duration_seconds * 1000
      const now = Date.now()
      const secondsLeft = Math.floor((eta - now) / 1000)

      if (secondsLeft <= 0) return 1000 // overdue
      if (secondsLeft <= 5 * 60) return 5000 // ≤5 min
      return 60 * 1000
    },
    staleTime: STALE_TIMES.INFINITY,
  })
}

export enum BridgeType {
  OP_WITHDRAW = "Optimistic bridge withdrawal",
  SKIP = "Skip",
}

export function getBridgeType(route: RouterRouteResponseJson) {
  const { operations, dest_asset_denom } = route
  if (has("op_init_transfer", head(operations)) && dest_asset_denom === "uinit") {
    return BridgeType.OP_WITHDRAW
  }
  return BridgeType.SKIP
}
