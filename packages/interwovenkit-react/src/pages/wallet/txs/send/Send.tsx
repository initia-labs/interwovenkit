import { FormProvider, useForm } from "react-hook-form"
import { useLocationState } from "@/lib/router"
import { useDefaultChain, type NormalizedChain } from "@/data/chains"
import { useAssets } from "@/data/assets"
import SendFields from "./SendFields"

export interface FormValues {
  chainId: string
  denom: string
  quantity: string
  recipient: string
  memo?: string
}

export const Send = () => {
  const state = useLocationState<{ denom: string; chain: NormalizedChain }>()

  const defaultChain = useDefaultChain()
  const defaultAssets = useAssets(defaultChain)
  const [primaryAsset] = defaultAssets
  const { chain = defaultChain, denom = primaryAsset.denom } = state

  const form = useForm<FormValues>({
    mode: "onChange",
    defaultValues: { chainId: chain.chainId, denom, quantity: "", recipient: "", memo: "" },
  })

  return (
    <FormProvider {...form}>
      <SendFields />
    </FormProvider>
  )
}

export default Send
