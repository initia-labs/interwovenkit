import Image from "@/components/Image"
import { useOnramperFiat } from "./data/onramper"
import styles from "./FiatFlag.module.css"

interface Props {
  /** Onramper fiat id (lowercase), e.g. "usd". */
  fiatId: string
  size?: number
}

/** Circular currency icon for a fiat, resolved from the supported-fiat list by
 * id (Onramper-served image, placeholder on error). */
const FiatFlag = ({ fiatId, size = 20 }: Props) => {
  const fiat = useOnramperFiat(fiatId)
  return (
    <Image
      src={fiat?.icon ?? ""}
      alt=""
      width={size}
      height={size}
      className={styles.flag}
      classNames={{ placeholder: styles.flag }}
    />
  )
}

export default FiatFlag
