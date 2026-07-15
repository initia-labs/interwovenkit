import Image from "@/components/Image"
import { useOnrampMetadata } from "./data/onramper"
import styles from "./ProviderLogo.module.css"

interface Props {
  /** Provider id (ramp), e.g. "moonpay". */
  ramp: string
  size?: number
}

/** A provider's logo from the Onramper onramp metadata. A ramp missing from
 * the metadata list or a failed load renders Image's gray placeholder. */
const ProviderLogo = ({ ramp, size = 24 }: Props) => {
  const metadata = useOnrampMetadata(ramp)
  return (
    <Image
      className={styles.logo}
      classNames={{ placeholder: styles.logo }}
      src={metadata?.icon}
      width={size}
      height={size}
      aria-hidden="true"
    />
  )
}

export default ProviderLogo
