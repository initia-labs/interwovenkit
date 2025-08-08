import clsx from "clsx"
import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { Popover } from "radix-ui"
import { IconChevronDown, IconCheckCircleFilled } from "@initia/icons-react"
import { useInitiaRegistry } from "@/data/chains"
import { usePortal } from "@/public/app/PortalContext"
import { useAutoFocus } from "./form/hooks"
import SearchInput from "./form/SearchInput"
import Status from "./Status"
import Image from "./Image"
import styles from "./ChainSelect.module.css"

interface Props {
  value: string
  onChange: (value: string) => void
  chainIds: string[]
  fullWidth?: boolean
}

const ChainSelect = ({ value, onChange, chainIds: relevantChains, fullWidth }: Props) => {
  const [searchQuery, setSearchQuery] = useState("")
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [maxHeight, setMaxHeight] = useState<number>()
  const itemsRef = useRef<HTMLDivElement[]>([])
  const triggerRef = useRef<HTMLButtonElement>(null)
  const allChains = useInitiaRegistry()

  // Filter chains based on relevantChains prop
  const chains = allChains.filter((chain) => relevantChains.includes(chain.chainId))
  const allChainsOption = useMemo(() => ({ chainId: "", name: "All rollups", logoUrl: "" }), [])

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

  // Reset search state when dropdown opens and calculate max height
  const open = () => {
    setSearchQuery("")
    setHighlightedIndex(-1)

    // Calculate max height based on trigger position
    if (triggerRef.current) {
      const styles = getComputedStyle(triggerRef.current)
      const gutter = parseInt(styles.getPropertyValue("--offset"))
      const triggerRect = triggerRef.current.getBoundingClientRect()
      const popoverTop = triggerRect.bottom + 6 // sideOffset
      const availableHeight = window.innerHeight - popoverTop - 2 * gutter
      setMaxHeight(availableHeight)
    }

    setIsOpen(true)
  }

  // Auto-scroll to keep highlighted item visible in viewport
  useEffect(() => {
    if (highlightedIndex >= 0 && highlightedIndex < itemsRef.current.length) {
      itemsRef.current[highlightedIndex]?.scrollIntoView({ block: "nearest", behavior: "instant" })
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
      <Popover.Trigger asChild>
        <button
          className={clsx(styles.trigger, { [styles.full]: fullWidth })}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          ref={triggerRef}
        >
          <div className={styles.triggerContent}>
            {selectedChain.logoUrl && <Image src={selectedChain.logoUrl} width={18} height={18} />}
            <span className={styles.triggerText}>{selectedChain.name}</span>
          </div>
          <IconChevronDown size={16} className={styles.icon} />
        </button>
      </Popover.Trigger>

      {isOpen && (
        <div
          className={styles.overlay}
          onClick={() => setIsOpen(false)}
          role="presentation"
          aria-hidden="true"
        />
      )}

      <Popover.Portal container={usePortal()}>
        <Popover.Content
          className={clsx(styles.popoverContent, { [styles.full]: fullWidth })}
          avoidCollisions={false}
          side="bottom"
          sideOffset={6}
          align="end"
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
                    {logoUrl && <Image src={logoUrl} width={18} height={18} />}
                    <span>{name}</span>
                  </div>
                  {value === chainId && <IconCheckCircleFilled size={14} />}
                </div>
              ))
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export default ChainSelect
