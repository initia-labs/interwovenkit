import type { EncodeObject } from "@cosmjs/proto-signing"
import type { BalanceResponseDenomEntryJson } from "@skip-go/client"
import type { MsgsResponseJson, OperationJson } from "@skip-go/client"
import BigNumber from "bignumber.js"
import type { KyInstance } from "ky"
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

interface GasPriceEntry {
  amount: string
  denom: string
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

/**
 * Decode Cosmos messages returned by the Skip API.
 *
 * The Skip API returns `msg_type_url` in proto format (e.g. "/cosmos.bank.v1beta1.MsgSend")
 * but `msg` in amino JSON format. This function bridges the two by looking up the amino type
 * for each proto type URL, then using `fromAmino` to produce EncodeObjects.
 */
export function decodeCosmosAminoMessages(
  msgs: Array<{ msg_type_url?: string; msg?: string }> | undefined,
  options: {
    fromAmino: (value: { type: string; value: unknown }) => EncodeObject
    converters: Record<string, { aminoType: string }>
  },
): EncodeObject[] {
  if (!msgs?.length) throw new Error("Invalid transaction data")

  return msgs.map(({ msg_type_url, msg }) => {
    if (!(msg_type_url && msg)) throw new Error("Invalid transaction data")
    const converter = options.converters[msg_type_url]
    if (!converter) throw new Error(`Unsupported message type: ${msg_type_url}`)
    return options.fromAmino({
      type: converter.aminoType,
      value: JSON.parse(msg),
    })
  })
}

export function computeRequiredFeeByDenom({
  gas,
  gasPrices,
  gasAdjustment = DEFAULT_GAS_ADJUSTMENT,
}: {
  gas: number
  gasPrices: GasPriceEntry[]
  gasAdjustment?: number
}) {
  return gasPrices.reduce(
    (result, { amount, denom }) => {
      result[denom] = BigNumber(gas)
        .times(gasAdjustment)
        .times(amount)
        .integerValue(BigNumber.ROUND_CEIL)
        .toFixed(0)
      return result
    },
    {} as Record<string, string>,
  )
}

export function hasSufficientFeeBalance({
  balances,
  requiredFeeByDenom,
  sourceDenom,
  amountIn,
}: {
  balances: Record<string, BalanceResponseDenomEntryJson>
  requiredFeeByDenom: Record<string, string>
  sourceDenom: string
  amountIn: string
}) {
  const feeDenoms = Object.keys(requiredFeeByDenom)
  if (feeDenoms.length === 0) return true

  return feeDenoms.some((denom) => {
    const balance = BigNumber(balances[denom]?.amount ?? "0")
    const spendAmount = denom === sourceDenom ? BigNumber(amountIn) : BigNumber(0)
    const requiredFee = BigNumber(requiredFeeByDenom[denom] ?? "0")
    return balance.minus(spendAmount).gte(requiredFee)
  })
}
