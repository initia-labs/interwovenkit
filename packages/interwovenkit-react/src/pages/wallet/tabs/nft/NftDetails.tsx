import Button from "@/components/Button"
import Footer from "@/components/Footer"
import Page from "@/components/Page"
import { useLocationState, useNavigate } from "@/lib/router"
import NftHeader from "./NftHeader"
import type { NormalizedNft } from "./queries"
import styles from "./NftDetails.module.css"

const NftDetails = () => {
  const navigate = useNavigate()
  const normalizedNft = useLocationState<NormalizedNft>()
  const { attributes } = normalizedNft

  return (
    <Page title="NFT details">
      <NftHeader normalizedNft={normalizedNft} chainIconSize={14} classNames={styles} />

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

          <div>
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
