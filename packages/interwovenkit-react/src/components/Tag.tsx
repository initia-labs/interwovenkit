import clsx from "clsx"
import styles from "./Tag.module.css"

type TagVariant = "default" | "accent" | "error" | "success"

interface Props {
  label: string
  variant?: TagVariant
}

const Tag = ({ label, variant = "default" }: Props) => {
  return <span className={clsx(styles.tag, styles[variant])}>{label}</span>
}

export default Tag
