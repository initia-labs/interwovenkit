import clsx from "clsx"
import type { ChangeEvent, InputHTMLAttributes, RefObject } from "react"
import { IconCloseCircleFilled, IconSearch } from "@initia/icons-react"
import styles from "./SearchInput.module.css"

export interface Props extends InputHTMLAttributes<HTMLInputElement> {
  rootClassName?: string
  padding?: number
  iconSize?: number
  ref?: RefObject<HTMLInputElement | null>
}

const SearchInput = ({ rootClassName, padding = 16, iconSize = 16, ref, ...attrs }: Props) => {
  return (
    <div
      className={clsx(styles.root, rootClassName, { [styles.hasValue]: attrs.value })}
      style={
        {
          "--search-input-padding": `${padding}px`,
          "--search-input-icon-size": `${iconSize}px`,
        } as React.CSSProperties
      }
    >
      <label htmlFor="search" className={styles.label}>
        <IconSearch size={iconSize} />
      </label>

      <input
        className={styles.input}
        id="search"
        type="text"
        maxLength={100}
        ref={ref}
        {...attrs}
      />

      {attrs.value && (
        <button
          className={styles.clear}
          onClick={() =>
            attrs.onChange?.({ target: { value: "" } } as ChangeEvent<HTMLInputElement>)
          }
        >
          <IconCloseCircleFilled size={iconSize} />
        </button>
      )}
    </div>
  )
}

export default SearchInput
