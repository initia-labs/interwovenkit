import clsx from "clsx"
import React from "react"
import { Select } from "@base-ui-components/react/select"
import { IconChevronDown } from "@initia/icons-react"
import { usePortal } from "@/public/app/PortalContext"
import styles from "./Dropdown.module.css"

export interface DropdownOption<T = string> {
  value: T
  label: string
  displayLabel?: string // Optional different label for the trigger display
}

interface DropdownProps<T = string>
  extends Omit<
    Select.Root.Props<string>,
    "value" | "onValueChange" | "defaultValue" | "multiple" | "children" | "items"
  > {
  options: DropdownOption<T>[]
  value: T
  onChange: (value: T) => void
  prefix?: React.ReactNode
  width?: string | number
  style?: React.CSSProperties
}

function Dropdown<T extends string | number = string>({
  options,
  value,
  onChange,
  prefix,
  width,
  style,
  ...selectRootProps
}: DropdownProps<T>) {
  const portalContainer = usePortal()

  const selectedOption = options.find((o) => o.value === value)
  if (!selectedOption) throw new Error("Selected option not found")

  // Single option, just display it
  if (options.length === 1) {
    return <span className={clsx("monospace")}>{selectedOption.label}</span>
  }

  const handleChange = (newValue: string) => {
    // Find the option with the string value and get its typed value
    const option = options.find((o) => String(o.value) === newValue)
    if (option) {
      onChange(option.value)
    }
  }

  const defaultTrigger = (
    <Select.Trigger
      className={clsx(styles.trigger, {
        [styles.disabled]: selectRootProps.disabled,
      })}
      style={{ ...style, ...(width ? { width } : {}) }}
    >
      <Select.Value>{selectedOption.displayLabel || selectedOption.label}</Select.Value>
      <Select.Icon className={styles.icon}>
        <IconChevronDown size={16} />
      </Select.Icon>
    </Select.Trigger>
  )

  return (
    <Select.Root
      {...selectRootProps}
      value={String(value)}
      onValueChange={handleChange}
      modal={selectRootProps.modal ?? false}
    >
      <div className={styles.value}>
        {prefix}
        {defaultTrigger}
      </div>

      <Select.Portal container={portalContainer}>
        <Select.Positioner
          className={clsx(styles.content)}
          alignItemWithTrigger={false}
          sideOffset={6}
          align={"end"}
        >
          <Select.Popup className={clsx(styles.popup)}>
            {options.map((option) => (
              <Select.Item
                className={clsx(styles.item)}
                style={{ ...style, minWidth: width || 152 }}
                value={String(option.value)}
                key={String(option.value)}
              >
                <Select.ItemText>{option.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  )
}

export default Dropdown
