import clsx from "clsx"
import Image from "@/components/Image"
import NftThumbnail from "./NftThumbnail"
import type { NormalizedNft } from "./queries"
import defaultStyles from "./NftHeader.module.css"

interface NftHeaderProps {
  normalizedNft: NormalizedNft
  onThumbnailClick?: () => void
  thumbnailSize?: number
  chainIconSize?: number
  classNames?: {
    root?: string
    collectionName?: string
    nftName?: string
    chainInfo?: string
  }
}

const NftHeader = ({
  normalizedNft,
  onThumbnailClick,
  thumbnailSize,
  chainIconSize = 12,
  classNames,
}: NftHeaderProps) => {
  const { collection_name, name, chain } = normalizedNft

  return (
    <div className={classNames?.root}>
      <NftThumbnail nftInfo={normalizedNft} onClick={onThumbnailClick} size={thumbnailSize} />
      <div>
        <div className={clsx(defaultStyles.collectionName, classNames?.collectionName)}>
          {collection_name}
        </div>
        <div className={clsx(defaultStyles.nftName, classNames?.nftName)}>{name}</div>
        <div className={clsx(defaultStyles.chainInfo, classNames?.chainInfo)}>
          <Image src={chain.logoUrl} width={chainIconSize} height={chainIconSize} logo />
          <span>{chain.name}</span>
        </div>
      </div>
    </div>
  )
}

export default NftHeader
