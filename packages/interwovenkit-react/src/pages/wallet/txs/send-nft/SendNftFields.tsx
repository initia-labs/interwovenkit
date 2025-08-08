import ky from "ky"
import clsx from "clsx"
import { VisuallyHidden } from "radix-ui"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { InitiaAddress } from "@initia/utils"
import { useAminoTypes } from "@/data/signer"
import type { AminoMsg } from "@cosmjs/amino"
import { useFormContext } from "react-hook-form"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useLocationState } from "@/lib/router"
import { useInterwovenKit } from "@/public/data/hooks"
import { useConfig } from "@/data/config"
import { useChain, useLayer1 } from "@/data/chains"
import { useAutoFocus } from "@/components/form/hooks"
import ModalTrigger from "@/components/ModalTrigger"
import RecipientInput from "@/components/form/RecipientInput"
import Button from "@/components/Button"
import Image from "@/components/Image"
import Footer from "@/components/Footer"
import ChainList from "../../components/ChainList"
import type { NormalizedNft } from "../../tabs/nft/queries"
import NftThumbnail from "../../tabs/nft/NftThumbnail"
import { createNftTransferParams } from "./tx"
import type { FormValues } from "./SendNft"
import styles from "./SendNftFields.module.css"

const queryKeys = createQueryKeys("interwovenkit:send-nft", {
  simulation: (params) => [params],
})

const SendNftFields = () => {
  const normalizedNft = useLocationState<NormalizedNft>()
  const { chain: srcChain, collection_name, image, name } = normalizedNft

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
      normalizedNft,
      sender,
      recipient,
      dstChainId,
      layer1,
      routerApiUrl,
    }).queryKey,
    queryFn: async () => {
      const { collection_addr, object_addr, token_id, chain: srcChain } = normalizedNft
      const params = Object.assign(
        {
          from_address: sender,
          from_chain_id: srcChain.chainId,
          to_address: InitiaAddress(recipient).bech32,
          to_chain_id: dstChainId,
          collection_address: collection_addr,
          token_ids: [token_id],
          object_addresses: [object_addr],
        },
        srcChain.chainId !== dstChainId &&
          (await createNftTransferParams({
            normalizedNft,
            intermediaryChain: layer1,
          })),
      )

      const { msgs } = await ky
        .create({ prefixUrl: routerApiUrl })
        .post("nft", { json: params })
        .json<{ msgs: AminoMsg[] }>()

      return msgs.map((msg) => aminoTypes.fromAmino(msg))
    },
    enabled: !!recipient,
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
        {image && <NftThumbnail nftInfo={normalizedNft} size={80} />}
        <div className={styles.name}>
          <div className={styles.collection}>{collection_name}</div>
          <div className={styles.nft}>{name}</div>
        </div>
      </header>

      <div className={styles.fields}>
        <VisuallyHidden.Root>
          <div>
            <div className="label">Destination rollup</div>

            <ModalTrigger
              title="Destination rollup"
              content={(close) => (
                <ChainList
                  onSelect={(chainId) => {
                    setValue("dstChainId", chainId)
                    close()
                  }}
                />
              )}
              className={clsx("input", styles.chain)}
            >
              <Image src={dstChain.logoUrl} width={20} height={20} />
              <span>{dstChain.name}</span>
            </ModalTrigger>
          </div>
        </VisuallyHidden.Root>

        <RecipientInput myAddress={address} ref={useAutoFocus()} />
      </div>

      <Footer>
        <Button.White loading={isLoading || isPending} disabled={!formState.isValid}>
          {error ? "Route not found" : "Confirm"}
        </Button.White>
      </Footer>
    </form>
  )
}

export default SendNftFields
