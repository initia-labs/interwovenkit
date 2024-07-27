import { useNavigate } from "@/lib/router"
import Image from "@/components/Image"
import type { NormalizedNft } from "./queries"
import NftThumbnail from "./NftThumbnail"
import styles from "./NftItem.module.css"

const NftItem = ({ normalizedNft }: { normalizedNft: NormalizedNft }) => {
  const { collection_name, name, chain } = normalizedNft
  const navigate = useNavigate()

  return (
    <div className={styles.nftItem}>
      <NftThumbnail nftInfo={normalizedNft} onClick={() => navigate("/nft", normalizedNft)} />
      <div>
        <div className={styles.collectionName}>{collection_name}</div>
        <div className={styles.nftName}>{name}</div>
        <div className={styles.chainInfo}>
          <Image src={chain.logoUrl} width={12} height={12} logo />
          <span>{chain.name}</span>
        </div>
      </div>
    </div>
  )
}

export default NftItem
