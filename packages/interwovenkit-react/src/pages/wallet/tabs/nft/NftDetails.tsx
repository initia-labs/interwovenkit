import type { AminoMsg } from "@cosmjs/amino"
import ky from "ky"
import { useQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import Image from "@/components/Image"
import Page from "@/components/Page"
import { useLayer1 } from "@/data/chains"
import { useConfig } from "@/data/config"
import { STALE_TIMES } from "@/data/http"
import { useAminoTypes } from "@/data/signer"
import { useTx } from "@/data/tx"
import { useLocationState, useNavigate } from "@/lib/router"
import { useInterwovenKit } from "@/public/data/hooks"
import NftThumbnail from "./NftThumbnail"
import type { NormalizedNft } from "./queries"
import styles from "./NftDetails.module.css"

/**
 * Query key for NFT transfer validation with on-chain simulation.
 * Not using a shared query key because this validation includes simulateTx,
 * which is separate from the route fetching query in SendNftFields.
 */
const nftValidationQueryKeys = createQueryKeys("interwovenkit:nft-details", {
  validation: (params) => [params],
})

const NftDetails = () => {
  const navigate = useNavigate()
  const normalizedNft = useLocationState<NormalizedNft>()
  const { collection_name, name, attributes, chain, collection_addr, token_id, object_addr } =
    normalizedNft

  const { routerApiUrl } = useConfig()
  const aminoTypes = useAminoTypes()
  const layer1 = useLayer1()
  const { initiaAddress: sender } = useInterwovenKit()
  const { simulateTx } = useTx()

  // Two-step validation: 1) Get messages from router API, 2) Simulate on chain
  const simulation = useQuery({
    queryKey: nftValidationQueryKeys.validation({
      collection_addr,
      nft: normalizedNft,
      token_id,
      object_addr,
      sender,
      recipient: sender,
      srcChain: chain,
      dstChain: chain,
      layer1,
      routerApiUrl,
    }).queryKey,
    queryFn: async () => {
      // Step 1: Get messages from router API
      const params = {
        from_address: sender,
        from_chain_id: chain.chainId,
        to_address: sender, // Send to own address for simulation
        to_chain_id: chain.chainId,
        collection_address: collection_addr,
        token_ids: [token_id],
        object_addresses: [object_addr],
      }

      const { msgs } = await ky
        .create({ prefixUrl: routerApiUrl })
        .post("nft", { json: params })
        .json<{ msgs: AminoMsg[] }>()

      const messages = msgs.map((msg) => aminoTypes.fromAmino(msg))

      // Step 2: Simulate on chain to verify the transaction can be executed
      return await simulateTx({ messages, chainId: chain.chainId })
    },
    staleTime: STALE_TIMES.INFINITY,
  })

  return (
    <Page title="NFT details">
      <header className={styles.header}>
        <NftThumbnail nftInfo={normalizedNft} />
        <div>
          <div className={styles.collectionName}>{collection_name}</div>
          <h2 className={styles.name}>{name}</h2>
          <div className={styles.chainInfo}>
            <Image src={chain.logoUrl} width={14} height={14} logo />
            <span>{chain.name}</span>
          </div>
        </div>
      </header>

      <Footer>
        <Button.White
          onClick={() => navigate("/nft/send", normalizedNft)}
          disabled={!simulation.data}
          loading={simulation.isLoading ? "Checking transferability..." : undefined}
          sm
        >
          {simulation.error ? "Non-transferable NFT" : "Send"}
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
