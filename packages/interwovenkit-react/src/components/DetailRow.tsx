import clsx from "clsx"
import styles from "./DetailRow.module.css"

interface Props {
  label: React.ReactNode
  children: React.ReactNode
  emphasized?: boolean
  valueStyle?: React.CSSProperties
}

const DetailRow = ({ label, children, emphasized, valueStyle }: Props) => {
  return (
    <div className={clsx(styles.row, emphasized && styles.emphasized)}>
      <p>{label}</p>
      <div className={styles.value} style={valueStyle}>
        {children}
      </div>
    </div>
  )
}

export default DetailRow
