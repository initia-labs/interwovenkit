import { IconClose } from "@initia/icons-react"
import Image from "@/components/Image"
import styles from "./ChainPill.module.css"

interface Props {
  name: string
  logoUrl: string
  onRemove: () => void
}

const ChainPill = ({ name, logoUrl, onRemove }: Props) => {
  return (
    <span className={styles.pill}>
      <Image src={logoUrl} width={14} height={14} logo />
      <span className={styles.name}>{name}</span>
      <button type="button" className={styles.remove} onClick={onRemove} aria-label="Remove chain">
        <IconClose size={10} />
      </button>
    </span>
  )
}

export default ChainPill
