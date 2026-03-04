import type { EncodeObject } from "@cosmjs/proto-signing"
import type { MsgsResponseJson, OperationJson, TxJson } from "@skip-go/client"
import BigNumber from "bignumber.js"
import type { KyInstance } from "ky"
import { aminoConverters, aminoTypes } from "@initia/amino-converter"
import { DEFAULT_GAS_ADJUSTMENT } from "@/public/data/constants"

interface BridgeRouteForMsgs {
  amount_in: string
  amount_out: string
  source_asset_chain_id: string
  source_asset_denom: string
  dest_asset_chain_id: string
  dest_asset_denom: string
  operations: OperationJson[]
}

interface BridgeMsgsParams {
  addressList: string[]
  route: BridgeRouteForMsgs
  slippagePercent: string
  signedOpHook?: { signer: string; hook: string }
}

interface FeeAssetWithGasPrice {
  denom: string
  gas_price?: {
    average?: string
  } | null
}

function buildBridgeMsgsPayload({
  addressList,
  route,
  slippagePercent,
  signedOpHook,
}: BridgeMsgsParams) {
  return {
    address_list: addressList,
    amount_in: route.amount_in,
    amount_out: route.amount_out,
    source_asset_chain_id: route.source_asset_chain_id,
    source_asset_denom: route.source_asset_denom,
    dest_asset_chain_id: route.dest_asset_chain_id,
    dest_asset_denom: route.dest_asset_denom,
    slippage_tolerance_percent: slippagePercent,
    operations: route.operations,
    signed_op_hook: signedOpHook,
  }
}

export async function fetchBridgeTxs(skip: KyInstance, params: BridgeMsgsParams) {
  const payload = buildBridgeMsgsPayload(params)
  const { txs } = await skip.post("v2/fungible/msgs", { json: payload }).json<MsgsResponseJson>()
  if (!txs || txs.length === 0) throw new Error("No transaction data found")
  return txs
}

export function buildInitiaAddressList({
  requiredChainAddresses,
  sender,
  recipient,
}: {
  requiredChainAddresses: string[]
  sender: string
  recipient: string
}) {
  return requiredChainAddresses.map((_, index) => {
    if (index === requiredChainAddresses.length - 1) {
      return recipient
    }
    return sender
  })
}

export function decodeCosmosAminoMessages(
  msgs: Array<{ msg_type_url?: string; msg?: string }> | undefined,
): EncodeObject[] {
  if (!msgs?.length) throw new Error("Invalid transaction data")

  return msgs.map(({ msg_type_url, msg }) => {
    if (!(msg_type_url && msg)) throw new Error("Invalid transaction data")
    const converter = aminoConverters[msg_type_url]
    if (!converter) throw new Error(`Unsupported message type: ${msg_type_url}`)
    return aminoTypes.fromAmino({
      type: converter.aminoType,
      value: JSON.parse(msg),
    })
  })
}

function getCosmosTxFromTxs(txs: TxJson[]) {
  const tx = txs[0]
  if (!tx || !("cosmos_tx" in tx) || !tx.cosmos_tx.msgs?.length) return null
  return tx.cosmos_tx
}

export async function fetchFirstCosmosTx(skip: KyInstance, params: BridgeMsgsParams) {
  const txs = await fetchBridgeTxs(skip, params)
  const cosmosTx = getCosmosTxFromTxs(txs)
  if (!cosmosTx) throw new Error("No cosmos transaction data found")
  return cosmosTx
}

export function computeRequiredFeeByDenom({
  gas,
  feeAssets,
  gasAdjustment = DEFAULT_GAS_ADJUSTMENT,
}: {
  gas: number
  feeAssets: FeeAssetWithGasPrice[]
  gasAdjustment?: number
}) {
  return feeAssets.reduce(
    (result, asset) => {
      const gasPrice = asset.gas_price?.average
      if (!gasPrice) return result
      result[asset.denom] = BigNumber(gas)
        .times(gasAdjustment)
        .times(gasPrice)
        .integerValue(BigNumber.ROUND_CEIL)
        .toFixed(0)
      return result
    },
    {} as Record<string, string>,
  )
}
