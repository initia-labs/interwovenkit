import clsx from "clsx"
import { Select } from "@base-ui/react/select"
import { IconCheck, IconChevronDown } from "@initia/icons-react"
import Image from "@/components/Image"
import { usePortal } from "@/public/app/PortalContext"
import styles from "./SourceSelector.module.css"

export interface SourceOption {
  value: string
  label: string
  logoUrl: string
  /** Right-aligned secondary text, e.g. a per-chain minimum ("Min $3"). */
  minLabel?: string
}

interface Props {
  /** Accessible label for the trigger ("Asset" / "Chain"). */
  label: string
  options: SourceOption[]
  value: string
  onChange: (value: string) => void
}

/**
 * Inline dropdown for picking a source asset or chain on the deposit QR screen.
 * Modeled on Dropdown (Base UI Select + portal for Shadow DOM), extended to show
 * a leading logo, an optional right-aligned minimum, and a selected check.
 */
const SourceSelector = ({ label, options, value, onChange }: Props) => {
  const portalContainer = usePortal()
  const selected = options.find((option) => option.value === value)

  // A single option is a fact, not a choice — render it statically, with no
  // popup and no chevron.
  if (options.length <= 1) {
    const option = options[0]
    return (
      <div className={styles.staticField}>
        <span className={styles.triggerValue}>
          {option && (
            <Image
              src={option.logoUrl}
              width={24}
              height={24}
              className={styles.logo}
              classNames={{ placeholder: styles.logo }}
            />
          )}
          <span className={styles.triggerLabel}>{option?.label}</span>
        </span>
      </div>
    )
  }

  const handleChange = (next: string | null) => {
    if (next === null) return
    const option = options.find((option) => option.value === next)
    if (option) onChange(option.value)
  }

  return (
    <Select.Root value={value} onValueChange={handleChange} modal={false}>
      <Select.Trigger className={styles.trigger} aria-label={label}>
        <span className={styles.triggerValue}>
          {selected && (
            <Image
              src={selected.logoUrl}
              width={24}
              height={24}
              className={styles.logo}
              classNames={{ placeholder: styles.logo }}
            />
          )}
          <span className={styles.triggerLabel}>{selected?.label ?? "Select"}</span>
        </span>
        <Select.Icon className={styles.icon}>
          <IconChevronDown size={16} aria-hidden="true" />
        </Select.Icon>
      </Select.Trigger>

      <Select.Portal container={portalContainer}>
        <Select.Positioner
          className={styles.positioner}
          alignItemWithTrigger={false}
          sideOffset={6}
          align="end"
        >
          <Select.Popup className={styles.popup}>
            {options.map((option) => (
              <Select.Item className={styles.item} value={option.value} key={option.value}>
                <Image
                  src={option.logoUrl}
                  width={20}
                  height={20}
                  className={styles.logo}
                  classNames={{ placeholder: styles.logo }}
                />
                <Select.ItemText className={styles.itemText}>{option.label}</Select.ItemText>
                {option.minLabel && <span className={styles.itemMin}>{option.minLabel}</span>}
                <IconCheck
                  size={12}
                  className={clsx(styles.itemIndicator, {
                    [styles.active]: option.value === value,
                  })}
                  aria-hidden="true"
                />
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  )
}

export default SourceSelector
