import { Select } from "@base-ui-components/react/select"
import { IconChevronDown } from "@initia/icons-react"
import clsx from "clsx"
import React from "react"
import { usePortal } from "@/public/app/PortalContext"
import styles from "./Dropdown.module.css"

export interface DropdownOption<T = string> {
  value: T
  label: string
  displayLabel?: string // Optional different label for the trigger display
}

interface DropdownProps<T = string> {
  options: DropdownOption<T>[]
  value: T
  onChange: (value: T) => void
  triggerClassName?: string
  contentClassName?: string
  itemClassName?: string
  renderTrigger?: (
    selectedOption: DropdownOption<T>,
    defaultTrigger: React.ReactNode,
  ) => React.ReactNode
  prefix?: React.ReactNode // Content to show before the trigger
  renderItem?: (option: DropdownOption<T>) => React.ReactNode
  align?: "start" | "end" | "center"
  sideOffset?: number
  disabled?: boolean
}

function Dropdown<T extends string | number = string>({
  options,
  value,
  onChange,
  triggerClassName,
  contentClassName,
  itemClassName,
  renderTrigger,
  prefix,
  renderItem,
  align = "end",
  sideOffset = 6,
  disabled = false,
}: DropdownProps<T>) {
  const portalContainer = usePortal()

  const selectedOption = options.find((o) => o.value === value)
  if (!selectedOption) throw new Error("Selected option not found")

  // Single option, just display it
  if (options.length === 1) {
    return <span className={clsx("monospace", triggerClassName)}>{selectedOption.label}</span>
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
      className={clsx(styles.trigger, triggerClassName, {
        [styles.disabled]: disabled,
      })}
    >
      <Select.Value>{selectedOption.displayLabel || selectedOption.label}</Select.Value>
      <Select.Icon className={styles.icon}>
        <IconChevronDown size={16} />
      </Select.Icon>
    </Select.Trigger>
  )

  return (
    <Select.Root
      value={String(value)}
      onValueChange={handleChange}
      modal={false}
      disabled={disabled}
    >
      {renderTrigger ? (
        renderTrigger(selectedOption, defaultTrigger)
      ) : (
        <div className={styles.value}>
          {prefix}
          {defaultTrigger}
        </div>
      )}

      <Select.Portal container={portalContainer}>
        <Select.Positioner
          className={clsx(styles.content, contentClassName)}
          alignItemWithTrigger={false}
          sideOffset={sideOffset}
          align={align}
        >
          <Select.Popup>
            {options.map((option) => (
              <Select.Item
                className={clsx(styles.item, itemClassName)}
                value={String(option.value)}
                key={String(option.value)}
              >
                <Select.ItemText>{renderItem ? renderItem(option) : option.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  )
}

export default Dropdown
