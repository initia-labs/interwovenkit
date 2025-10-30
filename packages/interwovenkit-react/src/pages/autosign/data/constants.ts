import type { DropdownOption } from "@/components/Dropdown"
import { DAY_IN_MS, HOUR_IN_MS, MINUTE_IN_MS, YEAR_IN_MS } from "@/data/constants"

export const DURATION_OPTIONS: DropdownOption<number>[] = [
  { value: 10 * MINUTE_IN_MS, label: "for 10 minutes" },
  { value: HOUR_IN_MS, label: "for 1 hour" },
  { value: DAY_IN_MS, label: "for 1 day" },
  { value: 7 * DAY_IN_MS, label: "for 7 days" },
  { value: 100 * YEAR_IN_MS, label: "Until revoked" },
]

export const DEFAULT_DURATION = DURATION_OPTIONS[0].value
