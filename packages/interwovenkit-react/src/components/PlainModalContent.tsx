import clsx from "clsx"
import type { PropsWithChildren, ReactNode } from "react"
import { IconChevronRight } from "@initia/icons-react"
import Scrollable from "./Scrollable"
import Button from "./Button"
import styles from "./PlainModalContent.module.css"

interface Props {
  type?: "warning"
  icon?: ReactNode
  title: string

  primaryButton: {
    label: string
    onClick: () => void
  }

  secondaryButton: {
    label: string
    onClick: () => void
  }
}

const PlainModalContent = (props: PropsWithChildren<Props>) => {
  const { type, icon, title, children, primaryButton, secondaryButton } = props

  return (
    <Scrollable className={styles.root}>
      <header className={clsx(styles.header, type && styles[type])}>
        {icon}
        <h1 className={styles.title}>{title}</h1>
      </header>

      <div className={styles.content}>{children}</div>

      <footer className={styles.footer}>
        <Button.White onClick={primaryButton.onClick} sm fullWidth>
          {primaryButton.label}
        </Button.White>

        <button className={styles.secondary} onClick={secondaryButton.onClick}>
          <span>{secondaryButton.label}</span>
          <IconChevronRight size={14} />
        </button>
      </footer>
    </Scrollable>
  )
}

export default PlainModalContent
