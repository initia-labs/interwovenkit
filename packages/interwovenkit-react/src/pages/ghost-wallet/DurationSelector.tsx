import clsx from "clsx"
import { useState, useEffect, useRef, useCallback } from "react"
import { Popover } from "@base-ui-components/react/popover"
import { IconChevronDown, IconCheck } from "@initia/icons-react"
import { usePortal } from "@/public/app/PortalContext"
import { usePortalCssVariable } from "@/public/app/PortalContext"
import styles from "./DurationSelector.module.css"

export type DurationOption = "1hour" | "1day" | "7days" | "until-revoked"

const DURATION_OPTIONS: Array<{ value: DurationOption; label: string; milliseconds: number }> = [
  { value: "1hour", label: "1 Hour", milliseconds: 60 * 60 * 1000 },
  { value: "1day", label: "1 Day", milliseconds: 24 * 60 * 60 * 1000 },
  { value: "7days", label: "7 Days", milliseconds: 7 * 24 * 60 * 60 * 1000 },
  { value: "until-revoked", label: "Until Revoked", milliseconds: 100 * 365 * 24 * 60 * 60 * 1000 },
]

interface Props {
  value: DurationOption
  onChange: (value: DurationOption) => void
  disabled?: boolean
  fullWidth?: boolean
}

const DurationSelector = ({ value, onChange, disabled = false, fullWidth }: Props) => {
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [maxHeight, setMaxHeight] = useState<number>()
  const itemsRef = useRef<HTMLDivElement[]>([])
  const triggerRef = useRef<HTMLButtonElement>(null)

  // Determine currently selected duration
  const selectedDuration =
    DURATION_OPTIONS.find((option) => option.value === value) || DURATION_OPTIONS[2]

  // Get the offset from the portal css variable
  const offset = parseInt(usePortalCssVariable("--drawer-offset"))
  const sideOffset = 6

  // Reset state and calculate max height when dropdown opens
  const open = () => {
    if (disabled) return

    setHighlightedIndex(-1)

    // Calculate max height based on trigger position
    if (triggerRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect()
      const popoverTop = triggerRect.bottom + sideOffset
      const availableHeight = window.innerHeight - popoverTop - 2 * offset
      setMaxHeight(availableHeight)
    }

    setIsOpen(true)
  }

  // Auto-scroll to keep highlighted item visible in viewport
  useEffect(() => {
    if (highlightedIndex >= 0 && highlightedIndex < itemsRef.current.length) {
      itemsRef.current[highlightedIndex]?.scrollIntoView({ block: "nearest", behavior: "auto" })
    }
  }, [highlightedIndex])

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) return

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault()
          setHighlightedIndex((prev) => (prev + 1) % DURATION_OPTIONS.length)
          break
        case "ArrowUp":
          e.preventDefault()
          setHighlightedIndex(
            (prev) => (prev - 1 + DURATION_OPTIONS.length) % DURATION_OPTIONS.length,
          )
          break
        case "Enter":
          e.preventDefault()
          if (DURATION_OPTIONS[highlightedIndex]) {
            onChange(DURATION_OPTIONS[highlightedIndex].value)
            setIsOpen(false)
          }
          break
        case "Escape":
          e.preventDefault()
          setIsOpen(false)
          break
      }
    },
    [isOpen, highlightedIndex, onChange],
  )

  const handleItemClick = (durationValue: DurationOption) => {
    onChange(durationValue)
    setIsOpen(false)
  }

  return (
    <Popover.Root open={isOpen} onOpenChange={open}>
      <Popover.Trigger
        render={
          <button
            className={clsx(styles.trigger, {
              [styles.full]: fullWidth,
              [styles.disabled]: disabled,
            })}
            aria-expanded={isOpen}
            role="listbox"
            ref={triggerRef}
            onKeyDown={handleKeyDown}
            disabled={disabled}
          >
            <div className={styles.triggerContent}>
              <span className={styles.triggerText}>{selectedDuration.label}</span>
            </div>
            <IconChevronDown size={16} className={styles.icon} />
          </button>
        }
      />

      <Popover.Portal container={usePortal()}>
        <Popover.Backdrop className={styles.popoverBackdrop} onClick={() => setIsOpen(false)} />
        <Popover.Positioner
          className={styles.popoverPositioner}
          align="end"
          side="bottom"
          sideOffset={sideOffset}
        >
          <Popover.Popup
            className={clsx(styles.popoverPopup, { [styles.full]: fullWidth })}
            style={{ maxHeight }}
          >
            <div className={styles.viewport} role="listbox">
              {DURATION_OPTIONS.map(({ value: optionValue, label }, index) => (
                <div
                  className={clsx(styles.item, {
                    [styles.highlighted]: index === highlightedIndex,
                  })}
                  onClick={() => handleItemClick(optionValue)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      handleItemClick(optionValue)
                    }
                  }}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  role="option"
                  aria-selected={value === optionValue}
                  tabIndex={-1}
                  ref={(el) => {
                    if (el) itemsRef.current[index] = el
                  }}
                  key={optionValue}
                >
                  <div className={styles.itemContent}>
                    <span>{label}</span>
                  </div>
                  {value === optionValue && <IconCheck size={16} />}
                </div>
              ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

export default DurationSelector
