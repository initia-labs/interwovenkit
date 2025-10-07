import type { AminoMsg } from "@cosmjs/amino"
import clsx from "clsx"
import ky from "ky"
import { VisuallyHidden } from "radix-ui"
import { useFormContext } from "react-hook-form"
import { useMutation, useQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { InitiaAddress } from "@initia/utils"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import { useAutoFocus } from "@/components/form/hooks"
import RecipientInput from "@/components/form/RecipientInput"
import Image from "@/components/Image"
import List from "@/components/List"
import ModalTrigger from "@/components/ModalTrigger"
import { useChain, useInitiaRegistry, useLayer1 } from "@/data/chains"
import { useConfig } from "@/data/config"
import { useAminoTypes } from "@/data/signer"
import { useLocationState } from "@/lib/router"
import { useInterwovenKit } from "@/public/data/hooks"
import NftThumbnail from "../../tabs/nft/NftThumbnail"
import type { NormalizedNft } from "../../tabs/nft/queries"
import type { FormValues } from "./SendNft"
import styles from "./SendNftFields.module.css"

const queryKeys = createQueryKeys("interwovenkit:send-nft", {
  simulation: (params) => [params],
})

const SendNftFields = () => {
  const chains = useInitiaRegistry()
  const nft = useLocationState<NormalizedNft>()
  const { chain: srcChain, collection_addr, collection_name, image, name } = nft

  const { routerApiUrl } = useConfig()
  const aminoTypes = useAminoTypes()
  const layer1 = useLayer1()
  const { address, initiaAddress: sender, requestTxSync } = useInterwovenKit()

  const { watch, setValue, handleSubmit, formState } = useFormContext<FormValues>()
  const values = watch()
  const { recipient, dstChainId } = values
  const dstChain = useChain(dstChainId)

  const simulation = useQuery({
    queryKey: queryKeys.simulation({
      collection_addr,
      nft,
      sender,
      recipient,
      srcChain,
      dstChain,
      layer1,
      routerApiUrl,
    }).queryKey,
    queryFn: async () => {
      const params = {
        from_address: sender,
        from_chain_id: srcChain.chainId,
        to_address: InitiaAddress(recipient).bech32,
        to_chain_id: dstChain.chainId,
        collection_address: collection_addr,
        token_ids: [nft.token_id],
        object_addresses: [nft.object_addr],
      }

      const { msgs } = await ky
        .create({ prefixUrl: routerApiUrl })
        .post("nft", { json: params })
        .json<{ msgs: AminoMsg[] }>()

      return msgs.map((msg) => aminoTypes.fromAmino(msg))
    },
    enabled: InitiaAddress.validate(recipient),
  })

  const { data: messages, isLoading, error } = simulation

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      if (!messages) throw new Error("Route not found")
      await requestTxSync({ messages, chainId: srcChain.chainId, internal: "/nfts" })
    },
  })

  return (
    <form onSubmit={handleSubmit(() => mutate())}>
      <header className={styles.header}>
        {image && <NftThumbnail nftInfo={nft} size={80} />}
        <div className={styles.name}>
          <div className={styles.collection}>{collection_name}</div>
          <div className={styles.nft}>{name}</div>
        </div>
      </header>

      <div className={styles.fields}>
        <VisuallyHidden.Root>
          <div>
            <div className="label">Destination appchain</div>

            <ModalTrigger
              title="Destination appchain"
              content={(close) => (
                <List
                  onSelect={({ chainId }) => {
                    setValue("dstChainId", chainId)
                    close()
                  }}
                  list={chains}
                  getImage={(item) => item.logoUrl}
                  getName={(item) => item.name}
                  getKey={(item) => item.chainId}
                />
              )}
              className={clsx("input", styles.chain)}
            >
              <Image src={dstChain.logoUrl} width={20} height={20} logo />
              <span>{dstChain.name}</span>
            </ModalTrigger>
          </div>
        </VisuallyHidden.Root>

        <RecipientInput myAddress={address} ref={useAutoFocus()} />
      </div>

      <Footer>
        <Button.White loading={isLoading || isPending} disabled={!formState.isValid || !!error}>
          {error ? "Route not found" : "Confirm"}
        </Button.White>
      </Footer>
    </form>
  )
}

export default SendNftFields
