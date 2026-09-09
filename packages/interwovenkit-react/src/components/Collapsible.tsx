import { useId } from "react"
import { useToggle } from "usehooks-ts"
import { IconChevronDown } from "@initia/icons-react"
import AnimatedHeight from "@/components/AnimatedHeight"
import styles from "./Collapsible.module.css"

interface Props {
  title: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}

const Collapsible = ({ title, defaultOpen = false, children }: Props) => {
  const [isOpen, toggleOpen] = useToggle(defaultOpen)
  const contentId = useId()

  return (
    <div>
      <button
        type="button"
        className={styles.button}
        onClick={toggleOpen}
        aria-expanded={isOpen}
        aria-controls={contentId}
      >
        {title}{" "}
        <IconChevronDown
          size={12}
          style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}
          aria-hidden="true"
        />
      </button>
      <AnimatedHeight>
        <div id={contentId}>{isOpen && <div className={styles.content}>{children}</div>}</div>
      </AnimatedHeight>
    </div>
  )
}

export default Collapsible
