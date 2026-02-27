import clsx from "clsx"
import { IconCloseCircleFilled, IconSearch } from "@initia/icons-react"
import { useAutoFocus } from "@/components/form/hooks"
import ChainPill from "./ChainPill"
import styles from "./UnifiedSearchInput.module.css"

import type { KeyboardEventHandler, RefObject } from "react"

interface LockedChain {
  name: string
  logoUrl: string
}

interface Props {
  lockedChain: LockedChain | null
  onRemoveChain: () => void
  search: string
  onSearchChange: (value: string) => void
  onKeyDown: KeyboardEventHandler
  inputRef?: RefObject<HTMLInputElement | null>
}

const UnifiedSearchInput = ({
  lockedChain,
  onRemoveChain,
  search,
  onSearchChange,
  onKeyDown,
  inputRef: externalRef,
}: Props) => {
  const autoRef = useAutoFocus()
  const ref = externalRef ?? autoRef

  return (
    <div className={clsx(styles.root, { [styles.hasValue]: search })}>
      <span className={styles.icon} aria-hidden>
        <IconSearch size={16} />
      </span>

      <div className={styles.inputArea}>
        {lockedChain && (
          <ChainPill
            name={lockedChain.name}
            logoUrl={lockedChain.logoUrl}
            onRemove={onRemoveChain}
          />
        )}

        <input
          className={styles.input}
          type="text"
          maxLength={100}
          placeholder={lockedChain ? "Search assets..." : "Try USDC, Ethereum..."}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={onKeyDown}
          ref={ref}
        />
      </div>

      {search && (
        <button
          type="button"
          className={styles.clear}
          aria-label="Clear search"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSearchChange("")}
        >
          <IconCloseCircleFilled size={16} />
        </button>
      )}
    </div>
  )
}

export default UnifiedSearchInput
