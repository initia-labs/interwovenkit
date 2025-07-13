import { useEffect } from "react"
import { useInView } from "react-intersection-observer"
import { IconChevronDown } from "@initia/icons-react"
import styles from "./LoadMoreButton.module.css"

const LoadMoreButton = ({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) => {
  const { ref, inView } = useInView()

  useEffect(() => {
    if (inView) {
      onClick()
    }
  }, [inView, onClick])

  return (
    <button className={styles.button} onClick={onClick} disabled={disabled} ref={ref}>
      <span>Load more</span>
      <IconChevronDown size={12} />
    </button>
  )
}

export default LoadMoreButton
