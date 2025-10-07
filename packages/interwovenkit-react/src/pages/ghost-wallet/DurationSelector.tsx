import Dropdown from "@/components/Dropdown"
import { DURATION_OPTIONS } from "./constants"

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
