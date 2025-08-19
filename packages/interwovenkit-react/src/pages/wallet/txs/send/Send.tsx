import { z } from "zod"
import type { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin"
import { useQueryClient } from "@tanstack/react-query"
import { FormProvider, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useLocationState } from "@/lib/router"
import { useInitiaAddress } from "@/public/data/hooks"
import { useDefaultChain, useFindChain, type NormalizedChain } from "@/data/chains"
import type { NormalizedAsset } from "@/data/assets"
import { assetQueryKeys, useAssets } from "@/data/assets"
import { accountQueryKeys } from "@/data/account"
import { quantitySuperRefine } from "@/data/form"
import { RecipientSchema } from "@/components/form/types"
import SendFields from "./SendFields"

const FormValuesSchema = z.object({
  chainId: z.string().nonempty(),
  denom: z.string().nonempty(),
  quantity: z.string().nonempty("Amount is required"),
  recipient: RecipientSchema,
  memo: z
    .string()
    .optional()
    .refine((value) => !value || new Blob([value]).size <= 256, "Memo is too long"),
})

export type FormValues = z.infer<typeof FormValuesSchema>

export const Send = () => {
  const state = useLocationState<{ denom: string; chain: NormalizedChain }>()

  const defaultChain = useDefaultChain()
  const defaultAssets = useAssets(defaultChain)
  const [primaryAsset] = defaultAssets
  const { chain = defaultChain, denom = primaryAsset.denom } = state

  const findChain = useFindChain()

  const address = useInitiaAddress()
  const queryClient = useQueryClient()
  const form = useForm<FormValues>({
    mode: "onChange",
    defaultValues: { chainId: chain.chainId, denom, quantity: "", recipient: "", memo: "" },
    resolver: zodResolver(
      FormValuesSchema.superRefine(({ chainId, denom, quantity }, ctx) => {
        const chain = findChain(chainId)
        const { decimals } = queryClient.getQueryData<NormalizedAsset>(
          assetQueryKeys.item(chainId, denom).queryKey,
        ) ?? { denom, symbol: denom, decimals: 0 }
        const balances =
          queryClient.getQueryData<Coin[]>(
            accountQueryKeys.balances(chain.restUrl, address).queryKey,
          ) ?? []
        const balance = balances.find((balance) => balance.denom === denom)?.amount
        quantitySuperRefine({ quantity, balance, decimals }, ctx)
      }),
    ),
  })

  return (
    <FormProvider {...form}>
      <SendFields />
    </FormProvider>
  )
}

export default Send
