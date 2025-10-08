import type { DropdownOption } from "@/components/Dropdown"

const SECOND_IN_MS = 1000
const MINUTE_IN_MS = 60 * SECOND_IN_MS
const HOUR_IN_MS = 60 * MINUTE_IN_MS
const DAY_IN_MS = 24 * HOUR_IN_MS
export const YEAR_IN_MS = 365 * DAY_IN_MS

export const DURATION_OPTIONS: DropdownOption<number>[] = [
  { value: 10 * MINUTE_IN_MS, label: "for 10 minutes" },
  { value: HOUR_IN_MS, label: "for 1 hour" },
  { value: DAY_IN_MS, label: "for 1 day" },
  { value: 7 * DAY_IN_MS, label: "for 7 days" },
  { value: 100 * YEAR_IN_MS, label: "Until Revoked" },
]

export const DEFAULT_DURATION = DURATION_OPTIONS[0].value
