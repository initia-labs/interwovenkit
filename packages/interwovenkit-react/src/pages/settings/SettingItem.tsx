import { IconChevronRight } from "@initia/icons-react"
import styles from "./SettingItem.module.css"

import type { ReactNode } from "react"

interface Props {
  title: string
  subtitle?: string
  rightSection?: ReactNode
  onClick: () => void
}

const SettingItem = ({ title, subtitle, rightSection, onClick }: Props) => {
  return (
    <button className={styles.link} onClick={onClick}>
      <div>
        <p className={styles.title}>{title}</p>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </div>

      <div className={styles.icon}>{rightSection ?? <IconChevronRight size={16} />}</div>
    </button>
  )
}

export default SettingItem
