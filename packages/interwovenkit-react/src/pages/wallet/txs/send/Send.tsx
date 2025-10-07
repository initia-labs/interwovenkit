import { head } from "ramda"
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

  const { chain = defaultChain } = state
  const primaryAsset = head(defaultAssets)

  if (!state.denom && !primaryAsset) {
    throw new Error(
      "Asset list not found. This occurs during local development when asset list is not configured. " +
        "Use asset-specific send buttons instead of the default send button, " +
        "or register chain in Initia Registry with at least one asset defined.",
    )
  }

  const denom = state.denom ?? primaryAsset?.denom

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
