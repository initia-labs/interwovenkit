import * as v from "valibot"
import { FormProvider, useForm } from "react-hook-form"
import { valibotResolver } from "@hookform/resolvers/valibot"
import { useLocationState } from "@/lib/router"
import { RecipientSchema } from "@/components/form/types"
import Page from "@/components/Page"
import type { NormalizedNft } from "../../tabs/nft/queries"
import SendNftFields from "./SendNftFields"

const FormValuesSchema = v.object({
  dstChainId: v.pipe(v.string(), v.nonEmpty()),
  recipient: RecipientSchema,
})

export type FormValues = v.InferOutput<typeof FormValuesSchema>

const SendNft = () => {
  const { chain: srcChain } = useLocationState<NormalizedNft>()

  const form = useForm<FormValues>({
    defaultValues: { dstChainId: srcChain.chainId },
    resolver: valibotResolver(FormValuesSchema),
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
