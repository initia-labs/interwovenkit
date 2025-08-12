import clsx from "clsx"
import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { Popover } from "@base-ui-components/react/popover"
import { IconChevronDown, IconCheckCircleFilled } from "@initia/icons-react"
import { useInitiaRegistry } from "@/data/chains"
import { usePortal } from "@/public/app/PortalContext"
import { usePortalCssVariable } from "@/public/app/PortalContext"
import { useAutoFocus } from "@/components/form/hooks"
import SearchInput from "@/components/form/SearchInput"
import Status from "@/components/Status"
import Image from "@/components/Image"
import styles from "./ChainSelect.module.css"

interface Props {
  value: string
  onChange: (value: string) => void
  chainIds: string[]
  fullWidth?: boolean
}

const ChainSelect = ({ value, onChange, chainIds, fullWidth }: Props) => {
  const [searchQuery, setSearchQuery] = useState("")
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [maxHeight, setMaxHeight] = useState<number>()
  const itemsRef = useRef<HTMLDivElement[]>([])
  const triggerRef = useRef<HTMLButtonElement>(null)
  const allChains = useInitiaRegistry()

  // Filter chains based on chainIds prop
  const chains = allChains.filter((chain) => chainIds.includes(chain.chainId))

  const renderAllRollupsLogo = (size: number) => {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 14 14">
        <path
          fill="var(--dimmed)"
          d="M5.69625 12.04C8.47976 12.04 10.7362 9.78348 10.7362 6.99996C10.7362 4.21645 8.47976 1.95996 5.69625 1.95996C2.91273 1.95996 0.65625 4.21645 0.65625 6.99996C0.65625 9.78348 2.91273 12.04 5.69625 12.04Z"
        />
        <path
          fill="var(--dimmed)"
          d="M9.66003 2.63379C10.85 3.71879 11.6025 5.26754 11.6025 7.00004C11.6025 8.73254 10.85 10.2813 9.66003 11.3663C11.7513 10.99 13.3438 9.19629 13.3438 7.00004C13.3438 4.80379 11.7513 3.00129 9.66003 2.63379Z"
        />
      </svg>
    )
  }

  const allChainsOption = useMemo(
    () => ({ chainId: "", name: "All rollups", logoUrl: renderAllRollupsLogo }),
    [],
  )

  // Build options list with "All rollups" option and apply search filtering
  // Search matches against both chain name and chain ID
  const options = useMemo(() => {
    const chainOptions = [allChainsOption, ...chains]
    if (!searchQuery) return chainOptions

    const query = searchQuery.toLowerCase()
    return chainOptions.filter(
      (chain) =>
        chain.name.toLowerCase().includes(query) || chain.chainId.toLowerCase().includes(query),
    )
  }, [chains, searchQuery, allChainsOption])

  // Determine currently selected chain, defaulting to "All rollups" if not found
  const selectedChain = chains.find((chain) => chain.chainId === value) || allChainsOption

  // Get the offset from the portal css variable
  const offset = parseInt(usePortalCssVariable("--drawer-offset"))
  const sideOffset = 6

  // Reset search state and calculate max height when dropdown opens
  const open = () => {
    setSearchQuery("")
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

  // Handle keyboard navigation in search input
  // ArrowDown/Up: Navigate through options with wrapping
  // Enter: Select highlighted option
  // Escape: Close dropdown
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault()
          // Wrap to first item after last
          setHighlightedIndex((prev) => (prev + 1) % options.length)
          break
        case "ArrowUp":
          e.preventDefault()
          // Wrap to last item before first
          setHighlightedIndex((prev) => (prev - 1 + options.length) % options.length)
          break
        case "Enter":
          e.preventDefault()
          if (options[highlightedIndex]) {
            onChange(options[highlightedIndex].chainId)
            setIsOpen(false)
          }
          break
        case "Escape":
          e.preventDefault()
          setIsOpen(false)
          break
      }
    },
    [options, highlightedIndex, onChange, setIsOpen],
  )

  const handleItemClick = (chainId: string) => {
    onChange(chainId)
    setIsOpen(false)
  }

  return (
    <Popover.Root open={isOpen} onOpenChange={open}>
      <Popover.Trigger
        render={
          <button
            className={clsx(styles.trigger, { [styles.full]: fullWidth })}
            aria-expanded={isOpen}
            role="listbox"
            ref={triggerRef}
          >
            <div className={styles.triggerContent}>
              {typeof selectedChain.logoUrl === "string" ? (
                <Image src={selectedChain.logoUrl} width={14} height={14} />
              ) : (
                selectedChain.logoUrl(14)
              )}
              <span className={styles.triggerText}>{selectedChain.name}</span>
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
            <SearchInput
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setHighlightedIndex(0)
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search rollups"
              rootClassName={styles.search}
              ref={useAutoFocus()}
            />

            <div className={styles.viewport} role="listbox">
              {options.length === 0 ? (
                <Status>No rollups found</Status>
              ) : (
                options.map(({ chainId, name, logoUrl }, index) => (
                  <div
                    className={clsx(styles.item, {
                      [styles.highlighted]: index === highlightedIndex,
                    })}
                    onClick={() => handleItemClick(chainId)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        handleItemClick(chainId)
                      }
                    }}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    role="option"
                    aria-selected={value === chainId}
                    tabIndex={-1}
                    ref={(el) => {
                      if (el) itemsRef.current[index] = el
                    }}
                    key={chainId}
                  >
                    <div className={styles.itemContent}>
                      {typeof logoUrl === "string" ? (
                        <Image src={logoUrl} width={18} height={18} />
                      ) : (
                        logoUrl(18)
                      )}
                      <span>{name}</span>
                    </div>
                    {value === chainId && <IconCheckCircleFilled size={14} />}
                  </div>
                ))
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

export default ChainSelect
