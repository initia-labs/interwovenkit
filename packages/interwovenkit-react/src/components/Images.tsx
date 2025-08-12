import clsx from "clsx"
import Image from "./Image"
import styles from "./Images.module.css"

interface Props {
  assetLogoUrl?: string
  assetLogoSize?: number
  chainLogoUrl?: string
  chainLogoSize?: number
  chainLogoOffset?: number
  className?: string
}

const Images = ({
  assetLogoUrl,
  assetLogoSize = 36,
  chainLogoUrl,
  chainLogoSize = 18,
  chainLogoOffset = 6,
  className,
}: Props) => {
  return (
    <div className={clsx(styles.images, className)}>
      <Image src={assetLogoUrl} width={assetLogoSize} height={assetLogoSize} />
      <Image
        src={chainLogoUrl}
        width={chainLogoSize}
        height={chainLogoSize}
        className={styles.chain}
        style={{ right: -1 * chainLogoOffset }}
      />
    </div>
  )
}

export default Images
