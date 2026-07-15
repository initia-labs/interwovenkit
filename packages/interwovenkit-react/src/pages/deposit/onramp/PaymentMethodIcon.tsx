import { IconPay } from "@initia/icons-react"
import Image from "@/components/Image"
import styles from "./PaymentMethodIcon.module.css"

interface Props {
  /** Onramper-served icon URL; falls back to a generic pay icon when absent. */
  iconUrl?: string
  size?: number
}

/** Icon for a payment method (SelectPaymentMethod rows + the form field):
 * a bare glyph centered in a fixed slot, no background chip. */
const PaymentMethodIcon = ({ iconUrl, size = 28 }: Props) => {
  // The glyph fills 20/32 of the slot; keep that ratio across sizes.
  const inner = Math.round(size * 0.625)
  return (
    <span className={styles.icon} style={{ width: size, height: size }} aria-hidden="true">
      {iconUrl ? (
        <Image src={iconUrl} alt="" width={inner} height={inner} />
      ) : (
        <IconPay size={inner} />
      )}
    </span>
  )
}

export default PaymentMethodIcon
