import BigNumber from "bignumber.js"
import { fromBaseUnit } from "@initia/utils"

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
// A sentence amount: at most 6 decimals, rounded down, no padding zeros. Nothing below one unit of
// the 6th decimal, so dust never reads as "0 … delivered".
function formatSentenceAmount(value: string): string | undefined {
  const rounded = value ? BigNumber(value).decimalPlaces(6, BigNumber.ROUND_DOWN) : undefined
  return rounded?.gt(0) ? rounded.toFormat() : undefined
}

export function formatCompletedAmount(params: CompletedAmountParams): string {
  const { amountOut, sentAmount, dstDecimals, srcDecimals, receiveSymbol, sentSymbol } = params

  // fromBaseUnit returns "" on invalid input, so "absent" and "unparseable" share the fallback.
  const delivered = formatSentenceAmount(
    amountOut && dstDecimals !== undefined
      ? fromBaseUnit(amountOut, { decimals: dstDecimals })
      : "",
  )
  if (delivered) return `${delivered} ${receiveSymbol}`

  const sent = formatSentenceAmount(
    sentAmount && srcDecimals !== undefined
      ? fromBaseUnit(sentAmount, { decimals: srcDecimals })
      : "",
  )
  if (sent) return `${sent} ${sentSymbol}`

  return `Your ${receiveSymbol}`
}
