import clsx from "clsx"
import { Select } from "@base-ui-components/react/select"
import { IconCheck, IconChevronDown } from "@initia/icons-react"
import { usePortal } from "@/public/app/PortalContext"
import styles from "./Dropdown.module.css"

export interface DropdownOption<T = string> {
  value: T
  label: string
  triggerLabel?: string
}

interface DropdownProps<T = string> {
  options: DropdownOption<T>[]
  value: T
  onChange: (value: T) => void
  classNames?: {
    trigger?: string
    item?: string
    itemText?: string
  }
}

function Dropdown<T extends string | number = string>({
  options,
  value,
  onChange,
  classNames,
}: DropdownProps<T>) {
  const portalContainer = usePortal()

  const selectedOption = options.find((option) => option.value === value)
  if (!selectedOption) throw new Error("Selected option not found")

  const handleChange = (value: string) => {
    const option = options.find((option) => String(option.value) === value)
    if (!option) throw new Error(`Option not found: ${value}`)
    onChange(option.value)
  }

  return (
    <Select.Root value={String(value)} onValueChange={handleChange} modal={false}>
      <Select.Trigger className={clsx(styles.trigger, classNames?.trigger)}>
        <Select.Value>{selectedOption.triggerLabel || selectedOption.label}</Select.Value>
        <Select.Icon className={styles.icon}>
          <IconChevronDown size={16} />
        </Select.Icon>
      </Select.Trigger>

      <Select.Portal container={portalContainer}>
        <Select.Positioner
          className={styles.content}
          alignItemWithTrigger={false}
          sideOffset={6}
          align={"end"}
        >
          <Select.Popup className={styles.popup}>
            {options.map((option) => (
              <Select.Item
                className={clsx(styles.item, classNames?.item)}
                value={String(option.value)}
                key={String(option.value)}
              >
                <Select.ItemText className={clsx(styles.itemText, classNames?.itemText)}>
                  {option.label}
                </Select.ItemText>
                <IconCheck
                  size={12}
                  className={clsx(styles.itemIndicator, {
                    [styles.active]: option.value === value,
                  })}
                />
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  )
}

export default Dropdown
