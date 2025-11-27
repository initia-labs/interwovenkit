import type { AminoMsg } from "@cosmjs/amino"
import clsx from "clsx"
import ky from "ky"
import { useMemo } from "react"
import { useFormContext } from "react-hook-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { InitiaAddress } from "@initia/utils"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import FormHelp from "@/components/form/FormHelp"
import { useAutoFocus } from "@/components/form/hooks"
import RecipientInput from "@/components/form/RecipientInput"
import Image from "@/components/Image"
import List from "@/components/List"
import ModalTrigger from "@/components/ModalTrigger"
import { useChain, useInitiaRegistry, useLayer1 } from "@/data/chains"
import { useConfig } from "@/data/config"
import { useTxFee } from "@/data/fee"
import { STALE_TIMES } from "@/data/http"
import { useAminoTypes } from "@/data/signer"
import { useLocationState } from "@/lib/router"
import TxFee from "@/pages/tx/TxFee"
import TxMeta from "@/pages/tx/TxMeta"
import { useInterwovenKit } from "@/public/data/hooks"
import NftHeader from "../../tabs/nft/NftHeader"
import { nftQueryKeys, type NormalizedNft } from "../../tabs/nft/queries"
import type { FormValues } from "./SendNft"
import { createNftTransferParams } from "./tx"
import styles from "./SendNftFields.module.css"

const queryKeys = createQueryKeys("interwovenkit:send-nft", {
  simulation: (params) => [params],
  gas: (messages, chainId) => [messages, chainId],
})

const SendNftFields = () => {
  const chains = useInitiaRegistry()
  const nft = useLocationState<NormalizedNft>()
  const { chain: srcChain, collection_addr } = nft

  const { routerApiUrl } = useConfig()
  const aminoTypes = useAminoTypes()
  const layer1 = useLayer1()
  const { address, initiaAddress: sender, estimateGas, submitTxSync } = useInterwovenKit()

  const { watch, setValue, handleSubmit, formState } = useFormContext<FormValues>()
  const { errors } = formState
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
      const params = Object.assign(
        {
          from_address: sender,
          from_chain_id: srcChain.chainId,
          to_address: InitiaAddress(recipient).bech32,
          to_chain_id: dstChain.chainId,
          collection_address: collection_addr,
          token_ids: [nft.token_id],
          object_addresses: [nft.object_addr],
        },
        srcChain.chainId !== dstChain.chainId &&
          (await createNftTransferParams({ nft, srcChain, intermediaryChain: layer1 })),
      )

      const { msgs } = await ky
        .create({ prefixUrl: routerApiUrl })
        .post("nft", { json: params })
        .json<{ msgs: AminoMsg[] }>()

      return msgs.map((msg) => aminoTypes.fromAmino(msg))
    },
    enabled: InitiaAddress.validate(recipient),
  })

  const { data: messages, isLoading: isLoadingMessages, error } = simulation

  // Estimate gas based on messages
  const gasQuery = useQuery({
    queryKey: queryKeys.gas(
      JSON.stringify(messages, (_, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
      srcChain.chainId,
    ).queryKey,
    queryFn: () => estimateGas({ messages: messages!, chainId: srcChain.chainId }),
    enabled: !!messages,
    staleTime: STALE_TIMES.INFINITY,
  })

  const { data: estimatedGas = 0, isLoading: isLoadingGas } = gasQuery

  const { feeOptions, feeDenom, setFeeDenom, getFee } = useTxFee({ chain: srcChain, estimatedGas })

  const queryClient = useQueryClient()
  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      if (!messages) throw new Error("Route not found")
      const fee = getFee()
      if (!fee) throw new Error("Fee not found")
      await submitTxSync({ messages, chainId: srcChain.chainId, fee, internal: "/nfts" })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: nftQueryKeys.nfts._def })
    },
  })

  const disabledMessage = useMemo(() => {
    if (!recipient) return "Enter recipient address"
    if (errors.recipient) return errors.recipient.message
    if (error) return "Route not found"
  }, [recipient, errors.recipient, error])

  return (
    <form onSubmit={handleSubmit(() => mutate())}>
      <NftHeader normalizedNft={nft} thumbnailSize={80} classNames={styles} />

      <div className={styles.fields}>
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

        <RecipientInput myAddress={address} ref={useAutoFocus()} />

        <FormHelp.Stack>
          <TxMeta>
            <TxMeta.Item
              title="Tx fee"
              content={
                <TxFee
                  chain={srcChain}
                  options={feeOptions}
                  value={feeDenom}
                  onChange={setFeeDenom}
                />
              }
            />
          </TxMeta>
        </FormHelp.Stack>
      </div>

      <Footer>
        <Button.White
          loading={
            (isLoadingMessages ? "Finding route..." : false) ||
            (isLoadingGas ? "Estimating gas..." : false) ||
            isPending
          }
          disabled={!!disabledMessage}
        >
          {disabledMessage ?? "Confirm"}
        </Button.White>
      </Footer>
    </form>
  )
}

export default SendNftFields
