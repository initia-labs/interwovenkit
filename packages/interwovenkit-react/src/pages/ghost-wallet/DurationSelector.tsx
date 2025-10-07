import Dropdown, { type DropdownOption } from "@/components/Dropdown"

const DURATION_OPTIONS: DropdownOption<number>[] = [
  { value: 10 * 60 * 1000, label: "for 10 minutes" },
  { value: 60 * 60 * 1000, label: "for 1 hour" },
  { value: 24 * 60 * 60 * 1000, label: "for 1 day" },
  { value: 7 * 24 * 60 * 60 * 1000, label: "for 7 days" },
  { value: 100 * 365 * 24 * 60 * 60 * 1000, label: "Until Revoked" },
]

interface Props {
  value: number
  onChange: (value: number) => void
  disabled?: boolean
}

const DurationSelector = ({ value, onChange, disabled = false }: Props) => {
  return (
    <Dropdown options={DURATION_OPTIONS} value={value} onChange={onChange} disabled={disabled} />
  )
}

export default DurationSelector
