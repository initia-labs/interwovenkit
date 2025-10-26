import Dropdown from "@/components/Dropdown"
import { DURATION_OPTIONS } from "./constants"

interface Props {
  value: number
  onChange: (value: number) => void
}

const DurationSelector = ({ value, onChange }: Props) => {
  return (
    <Dropdown
      options={DURATION_OPTIONS}
      value={value}
      onChange={onChange}
      width={140}
      triggerClassName="duration-selector-trigger"
    />
  )
}

export default DurationSelector
