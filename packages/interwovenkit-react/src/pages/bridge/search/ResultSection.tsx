import styles from "./ResultSection.module.css"

import type { PropsWithChildren } from "react"

interface Props {
  label: string
}

const ResultSection = ({ label, children }: PropsWithChildren<Props>) => {
  return (
    <div className={styles.section}>
      <h3 className={styles.label}>{label}</h3>
      {children}
    </div>
  )
}

export default ResultSection
