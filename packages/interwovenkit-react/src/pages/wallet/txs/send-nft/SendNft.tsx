import { FormProvider, useForm } from "react-hook-form"
import Page from "@/components/Page"
import { useLocationState } from "@/lib/router"
import type { NormalizedNft } from "../../tabs/nft/queries"
import SendNftFields from "./SendNftFields"

export interface FormValues {
  dstChainId: string
  recipient: string
}

const SendNft = () => {
  const { chain: srcChain } = useLocationState<NormalizedNft>()

  const form = useForm<FormValues>({
    mode: "onChange",
    defaultValues: { dstChainId: srcChain.chainId, recipient: "" },
  })

  return (
    <Page title="Send NFT">
      <FormProvider {...form}>
        <SendNftFields />
      </FormProvider>
    </Page>
  )
}

export default SendNft
