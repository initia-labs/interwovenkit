import type { FeeJson } from "@skip-go/client"
import BigNumber from "bignumber.js"
import { formatAmount } from "@initia/utils"
import { parseQuantity } from "@/lib/amountValidation"

const TIME_UNIT_DEFINITIONS = [
  ["d", 24 * 60 * 60], // day
  ["h", 60 * 60], // hour
  ["m", 60], // minute
  ["s", 1], // second
] as const

export function formatDuration(totalSeconds: number) {
  if (!totalSeconds) return

  const { formattedParts } = TIME_UNIT_DEFINITIONS.reduce(
    ({ remainingSeconds, formattedParts }, [unitLabel, unitDurationInSeconds]) => {
      const unitCount = Math.floor(remainingSeconds / unitDurationInSeconds)
      return {
        remainingSeconds: remainingSeconds - unitCount * unitDurationInSeconds,
        formattedParts:
          unitCount > 0 ? [...formattedParts, `${unitCount}${unitLabel}`] : formattedParts,
      }
    },
    { remainingSeconds: totalSeconds, formattedParts: [] as string[] },
  )

  return formattedParts.join(" ")
}

export function calculateMinimumReceived(amountOut: string, slippagePercent: string): string {
  // slippagePercent is user-typed (SlippageControl) and can be persisted as
  // mid-input forms like "." through localStorage. Truthy "." bypasses `|| 0`
  // and throws under BigNumber strict mode (v10+ default). Route the inputs
  // through parseQuantity so invalid values normalize to zero.
  const amount = parseQuantity(amountOut) ?? BigNumber(0)
  const slippage = parseQuantity(slippagePercent) ?? BigNumber(0)
  return amount
    .times(BigNumber(100).minus(slippage))
    .div(100)
    .integerValue(BigNumber.ROUND_FLOOR)
    .toFixed(0)
}

export function formatFees(fees?: FeeJson[]) {
  return fees
    ?.map((fee) => {
      const { amount, origin_asset } = fee
      return `${formatAmount(amount, { decimals: origin_asset.decimals ?? 0 })} ${origin_asset.symbol}`
    })
    .join(", ")
}
