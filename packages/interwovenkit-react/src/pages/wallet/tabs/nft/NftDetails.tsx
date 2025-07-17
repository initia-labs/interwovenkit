import { useLocationState, useNavigate } from "@/lib/router"
import Page from "@/components/Page"
import Footer from "@/components/Footer"
import Button from "@/components/Button"
import type { ChainCollectionNftCollectionState } from "./queries"
import NftThumbnail from "./NftThumbnail"
import styles from "./NftDetails.module.css"

const NftDetails = () => {
  const navigate = useNavigate()
  const state = useLocationState<ChainCollectionNftCollectionState>("/nft")
  const { collection, nft, chain } = state
  if (!nft) return null
  const { image, name, attributes } = nft

  return (
    <Page title={collection.name}>
      <header className={styles.header}>
        {image && <NftThumbnail chain={chain} collection={collection} nft={nft} />}
        <h2 className={styles.name}>{name}</h2>
      </header>

      <Footer>
        <Button.White onClick={() => navigate("/nft/send", state)}>Send</Button.White>
      </Footer>

      {attributes && (
        <div className={styles.attributes}>
          <header className={styles.title}>Traits ({attributes.length})</header>

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
