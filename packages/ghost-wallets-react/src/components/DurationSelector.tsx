import { useState, useEffect, useRef, useCallback, type CSSProperties } from "react"
import { Popover } from "@base-ui-components/react/popover"
import { IconChevronDown, IconCheck } from "@initia/icons-react"

const DURATION_OPTIONS: Array<{ milliseconds: number; label: string }> = [
  { milliseconds: 10 * 60 * 1000, label: "for 10 minutes" },
  { milliseconds: 60 * 60 * 1000, label: "for 1 hour" },
  { milliseconds: 24 * 60 * 60 * 1000, label: "for 1 day" },
  { milliseconds: 7 * 24 * 60 * 60 * 1000, label: "for 7 days" },
  { milliseconds: 100 * 365 * 24 * 60 * 60 * 1000, label: "Until Revoked" },
]

interface Props {
  value: number
  onChange: (value: number) => void
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
    DURATION_OPTIONS.find((option) => option.milliseconds === value) || DURATION_OPTIONS[0]

  // Get the offset from the portal css variable
  const offset = 4 //parseInt(usePortalCssVariable("--drawer-offset"))
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
            onChange(DURATION_OPTIONS[highlightedIndex].milliseconds)
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

  const handleItemClick = (milliseconds: number) => {
    onChange(milliseconds)
    setIsOpen(false)
  }

  const triggerStyles: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "2px",
    borderRadius: "8px",
    border: "1px solid var(--home-border)",
    color: "var(--gray-0)",
    fontSize: "12px",
    fontWeight: 600,
    padding: "0px 16px",
    transition: "border-color var(--transition) ease",
    width: fullWidth ? "100%" : "132px",
    height: "44px",
    background: "transparent",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  }

  const iconStyles: CSSProperties = {
    color: "var(--dimmed)",
    transition: "transform var(--transition)",
    transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
  }

  const backdropStyles: CSSProperties = {
    position: "fixed",
    top: "1px",
    left: "1px",
    right: "1px",
    bottom: "1px",
    animation: "fadeIn var(--transition) ease-out",
    background: "rgba(0, 0, 0, 0.8)",
    borderRadius: "var(--border-radius)",
    zIndex: 9999,
  }

  const popupStyles: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    animation: "slideDown var(--transition) ease-out",
    background: "var(--gray-8)",
    borderRadius: "8px",
    border: "1px solid var(--gray-6)",
    boxShadow: "0 0 10px 0 rgba(0, 0, 0, 0.2)",
    overflow: "hidden",
    width: fullWidth ? "var(--anchor-width)" : "240px",
    maxHeight,
  }

  const viewportStyles: CSSProperties = {
    flex: 1,
    overflowY: "auto",
  }

  const getItemStyles = (isHighlighted: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    color: "var(--gray-0)",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 600,
    height: "44px",
    padding: "0 14px",
    transition: "background-color var(--transition) ease",
    background: isHighlighted ? "var(--gray-7)" : "transparent",
  })

  return (
    <>
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
      <Popover.Root open={isOpen} onOpenChange={open}>
        <Popover.Trigger
          render={
            <button
              style={triggerStyles}
              aria-expanded={isOpen}
              role="listbox"
              ref={triggerRef}
              onKeyDown={handleKeyDown}
              disabled={disabled}
              onMouseEnter={(e) => {
                if (!disabled) {
                  e.currentTarget.style.borderColor = "var(--home-border-hover)"
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--home-border)"
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {selectedDuration.label}
                </span>
              </div>
              <IconChevronDown size={16} style={iconStyles} />
            </button>
          }
        />

        <Popover.Portal container={document.body}>
          <Popover.Backdrop style={backdropStyles} onClick={() => setIsOpen(false)} />
          <Popover.Positioner
            style={{ zIndex: 10000 }}
            align="end"
            side="bottom"
            sideOffset={sideOffset}
          >
            <Popover.Popup style={popupStyles}>
              <div style={viewportStyles} role="listbox">
                {DURATION_OPTIONS.map(({ milliseconds, label }, index) => (
                  <div
                    style={getItemStyles(index === highlightedIndex)}
                    onClick={() => handleItemClick(milliseconds)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        handleItemClick(milliseconds)
                      }
                    }}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    role="option"
                    aria-selected={value === milliseconds}
                    tabIndex={-1}
                    ref={(el) => {
                      if (el) itemsRef.current[index] = el
                    }}
                    key={milliseconds}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      <span>{label}</span>
                    </div>
                    {value === milliseconds && <IconCheck size={16} />}
                  </div>
                ))}
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </>
  )
}

export default DurationSelector
