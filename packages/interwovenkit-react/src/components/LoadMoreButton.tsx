import { IconChevronDown } from "@initia/icons-react"
import styles from "./LoadMoreButton.module.css"

const LoadMoreButton = ({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) => {
  return (
    <button className={styles.button} onClick={onClick} disabled={disabled}>
      <span>Load more</span>
      <IconChevronDown size={12} aria-hidden="true" />
    </button>
  )
}

export default LoadMoreButton
