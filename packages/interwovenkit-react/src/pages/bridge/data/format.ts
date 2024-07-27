import type { FeeJson } from "@skip-go/client"
import { formatAmount } from "@initia/utils"

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

export function formatFees(fees?: FeeJson[]) {
  return fees
    ?.map((fee) => {
      const { amount, origin_asset } = fee
      return `${formatAmount(amount, { decimals: origin_asset.decimals ?? 0 })} ${origin_asset.symbol}`
    })
    .join(", ")
}
