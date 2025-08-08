import clsx from "clsx"
import type { ChangeEvent, InputHTMLAttributes, RefObject } from "react"
import { IconCloseCircleFilled, IconSearch } from "@initia/icons-react"
import styles from "./SearchInput.module.css"

export interface Props extends InputHTMLAttributes<HTMLInputElement> {
  ref?: RefObject<HTMLInputElement | null>
  rootClassName?: string
}

const SearchInput = ({ ref, rootClassName, ...attrs }: Props) => {
  return (
    <div className={clsx(styles.root, rootClassName)}>
      <label htmlFor="search" className={styles.label}>
        <IconSearch size={16} />
      </label>

      <input id="search" type="text" className={styles.input} ref={ref} {...attrs} />

      {attrs.value && (
        <button
          className={styles.clear}
          onClick={() =>
            attrs.onChange?.({ target: { value: "" } } as ChangeEvent<HTMLInputElement>)
          }
        >
          <IconCloseCircleFilled size={16} />
        </button>
      )}
    </div>
  )
}

export default SearchInput
