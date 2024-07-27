import clsx from "clsx"
import Image from "@/components/Image"
import type { NftInfo } from "./queries"
import styles from "./NftThumbnail.module.css"

interface Props {
  nftInfo: NftInfo
  size?: number
  onClick?: () => void
}

const NftThumbnail = ({ nftInfo, size, onClick }: Props) => {
  const { collection_addr, object_addr, nft, chain } = nftInfo

  const src = new URL(
    `/v1/${chain.chainId}/${collection_addr}/${object_addr || nft.token_id}`,
    "https://glyph.initia.xyz",
  ).toString()

  if (onClick) {
    return (
      <button
        className={clsx(styles.thumbnail, styles.clickable)}
        onClick={onClick}
        style={{ width: size, height: size }}
      >
        <Image src={src} classNames={{ placeholder: styles.placeholder }} />
      </button>
    )
  }

  return (
    <div className={styles.thumbnail} style={{ width: size, height: size }}>
      <Image src={src} classNames={{ placeholder: styles.placeholder }} />
    </div>
  )
}

export default NftThumbnail
