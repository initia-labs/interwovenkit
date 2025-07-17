import { z } from "zod"
import { FormProvider, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useLocationState } from "@/lib/router"
import { RecipientSchema } from "@/components/form/types"
import Page from "@/components/Page"
import type { ChainCollectionNftCollectionState } from "../../tabs/nft/queries"
import SendNftFields from "./SendNftFields"

const FormValuesSchema = z.object({
  dstChainId: z.string().nonempty(),
  recipient: RecipientSchema,
})

export type FormValues = z.infer<typeof FormValuesSchema>

const SendNft = () => {
  const { chain: srcChain } = useLocationState<ChainCollectionNftCollectionState>("/nft/send")

  const form = useForm<FormValues>({
    defaultValues: { dstChainId: srcChain.chainId },
    resolver: zodResolver(FormValuesSchema),
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
