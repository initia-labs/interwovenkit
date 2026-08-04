import BigNumber from "bignumber.js"
import { formatNumber, fromBaseUnit } from "@initia/utils"

export interface CompletedAmountParams {
  /** Router-quoted destination base units (`Deposit.amount_out`); an estimate, not a measured receipt. */
  amountOut: string | undefined
  /** Source base units the user sent (`Deposit.amount`). */
  sentAmount: string | undefined
  /** Destination decimals; undefined when the route is gone from the Deposit
   * API's `config/assets`. */
  dstDecimals: number | undefined
  /** Source decimals; undefined when the route is gone from the Deposit API's
   * `config/assets`. */
  srcDecimals: number | undefined
  receiveSymbol: string
  sentSymbol: string
}

/**
 * Amount phrase for the completed copy, in preference order:
 *
 * 1. "{amount_out} {receiveSymbol}" — the router quote at bridge-planning time,
 *    not a measured receipt (delivery may differ within route-policy slippage),
 *    rendered plainly with no approximation mark. Requires a positive parse:
 *    "0 … was delivered" for a zero or unparseable quote would read as lost
 *    funds on a delivery that actually succeeded.
 * 2. The sent (source) amount with the source symbol — when `amount_out` is
 *    absent (e.g. the instant-advance path, no bridge planning). The
 *    destination symbol would misstate swap routes, hence the source symbol.
 * 3. "Your {receiveSymbol}" — when neither amount can be formatted (route gone
 *    from the Deposit API's `config/assets`, so no decimals to format with).
 */
export function formatCompletedAmount(params: CompletedAmountParams): string {
  const { amountOut, sentAmount, dstDecimals, srcDecimals, receiveSymbol, sentSymbol } = params

  // fromBaseUnit returns "" on invalid input, so the truthiness check folds
  // "absent" and "unparseable" into the same fallback.
  const delivered =
    amountOut && dstDecimals !== undefined ? fromBaseUnit(amountOut, { decimals: dstDecimals }) : ""
  if (delivered && BigNumber(delivered).gt(0)) {
    return `${formatNumber(delivered, { dp: 6 })} ${receiveSymbol}`
  }

  const sent =
    sentAmount && srcDecimals !== undefined
      ? fromBaseUnit(sentAmount, { decimals: srcDecimals })
      : ""
  if (sent && BigNumber(sent).gt(0)) {
    return `${formatNumber(sent, { dp: 6 })} ${sentSymbol}`
  }

  return `Your ${receiveSymbol}`
}
