import { useLocationState, useNavigate } from "@/lib/router"
import Page from "@/components/Page"
import Image from "@/components/Image"
import Footer from "@/components/Footer"
import Button from "@/components/Button"
import type { NormalizedNft } from "./queries"
import NftThumbnail from "./NftThumbnail"
import styles from "./NftDetails.module.css"

const NftDetails = () => {
  const navigate = useNavigate()
  const normalizedNft = useLocationState<NormalizedNft>()
  const { collection_name, image, name, attributes, chain } = normalizedNft

  return (
    <Page title="NFT details">
      <header className={styles.header}>
        {image && <NftThumbnail nftInfo={normalizedNft} />}
        <div>
          <div className={styles.collectionName}>{collection_name}</div>
          <h2 className={styles.name}>{name}</h2>
          <div className={styles.chainInfo}>
            <Image src={chain.logoUrl} width={14} height={14} />
            <span>{chain.name}</span>
          </div>
        </div>
      </header>

      <Footer>
        <Button.White onClick={() => navigate("/nft/send", normalizedNft)} sm>
          Send
        </Button.White>
      </Footer>

      {attributes && (
        <div className={styles.attributes}>
          <header className={styles.title}>
            Traits <span className={styles.count}>({attributes.length})</span>
          </header>

          <div className={styles.list}>
            {attributes.map(({ trait_type, value }) => (
              <div key={trait_type} className={styles.item}>
                <div className={styles.type}>{trait_type}</div>
                <div className={styles.value}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Page>
  )
}

export default NftDetails
