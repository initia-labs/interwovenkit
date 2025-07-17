import clsx from "clsx"
import { IconCloseCircleFilled, IconSearch } from "@initia/icons-react"
import { useAutoFocus } from "./hooks"
import styles from "./SearchInput.module.css"

interface Props {
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  className?: string
}

const SearchInput = ({ value = "", onChange, placeholder = "Search", className }: Props) => {
  return (
    <div className={clsx(styles.root, className)}>
      <label htmlFor="search" className={styles.label}>
        <IconSearch size={16} />
      </label>

      <input
        id="search"
        type="text"
        className={styles.input}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        readOnly={!onChange}
        ref={useAutoFocus()}
      />

      {value && (
        <button className={styles.clear} onClick={() => onChange?.("")}>
          <IconCloseCircleFilled size={20} />
        </button>
      )}
    </div>
  )
}

export default SearchInput
