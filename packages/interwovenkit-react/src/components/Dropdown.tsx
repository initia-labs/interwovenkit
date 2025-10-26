import clsx from "clsx"
import React from "react"
import { Select } from "@base-ui-components/react/select"
import { IconCheck, IconChevronDown } from "@initia/icons-react"
import { usePortal } from "@/public/app/PortalContext"
import styles from "./Dropdown.module.css"

export interface DropdownOption<T = string> {
  value: T
  label: string
  triggerLabel?: string // Optional different label for the trigger display
}

interface DropdownProps<T = string> {
  options: DropdownOption<T>[]
  value: T
  onChange: (value: T) => void
  prefix?: React.ReactNode
  width?: string | number
  triggerClassName?: string
  classNames?: {
    root?: string
    trigger?: string
    content?: string
    popup?: string
    item?: string
  }
}

function Dropdown<T extends string | number = string>({
  options,
  value,
  onChange,
  prefix,
  width,
  triggerClassName,
  classNames,
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
      className={clsx(styles.trigger, triggerClassName, classNames?.trigger)}
      style={width ? { width } : undefined}
    >
      <Select.Value>{selectedOption.triggerLabel || selectedOption.label}</Select.Value>
      <Select.Icon className={styles.icon}>
        <IconChevronDown size={16} />
      </Select.Icon>
    </Select.Trigger>
  )

  return (
    <Select.Root value={String(value)} onValueChange={handleChange} modal={false}>
      <div className={clsx(styles.value, classNames?.root)}>
        {prefix}
        {defaultTrigger}
      </div>

      <Select.Portal container={portalContainer}>
        <Select.Positioner
          className={clsx(styles.content, classNames?.content)}
          alignItemWithTrigger={false}
          sideOffset={6}
          align={"end"}
        >
          <Select.Popup className={clsx(styles.popup, classNames?.popup)}>
            {options.map((option) => (
              <Select.Item
                className={styles.item}
                style={{ minWidth: width || 152 }}
                value={String(option.value)}
                key={String(option.value)}
              >
                <Select.ItemText>
                  <span className={clsx(styles.itemContent, classNames?.item)}>
                    {option.label}
                    <IconCheck
                      size={12}
                      className={clsx({ [styles.iconHidden]: option.value !== value })}
                    />
                  </span>
                </Select.ItemText>
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  )
}

export default Dropdown
