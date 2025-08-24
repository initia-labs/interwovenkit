import * as v from "valibot"
import BigNumber from "bignumber.js"
import type { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin"
import { useQueryClient } from "@tanstack/react-query"
import { FormProvider, useForm } from "react-hook-form"
import { valibotResolver } from "@hookform/resolvers/valibot"
import { toBaseUnit } from "@initia/utils"
import { useLocationState } from "@/lib/router"
import { useInitiaAddress } from "@/public/data/hooks"
import { useDefaultChain, useFindChain, type NormalizedChain } from "@/data/chains"
import type { NormalizedAsset } from "@/data/assets"
import { assetQueryKeys, useAssets } from "@/data/assets"
import { accountQueryKeys } from "@/data/account"
import { RecipientSchema } from "@/components/form/types"
import SendFields from "./SendFields"

const FormValuesSchema = v.object({
  chainId: v.pipe(v.string(), v.nonEmpty()),
  denom: v.pipe(v.string(), v.nonEmpty()),
  quantity: v.pipe(
    v.string(),
    v.nonEmpty("Enter amount"),
    v.check((quantity) => BigNumber(quantity).gt(0), "Enter amount"),
  ),
  recipient: RecipientSchema,
  memo: v.optional(
    v.pipe(
      v.string(),
      v.check((value) => !value || new Blob([value]).size <= 256, "Memo is too long"),
    ),
  ),
})

export type FormValues = v.InferOutput<typeof FormValuesSchema>

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
    resolver: valibotResolver(
      v.pipe(
        FormValuesSchema,
        v.forward(
          v.check(({ chainId, denom, quantity }) => {
            const chain = findChain(chainId)
            const { decimals } = queryClient.getQueryData<NormalizedAsset>(
              assetQueryKeys.item(chainId, denom).queryKey,
            ) ?? { denom, symbol: denom, decimals: 0 }
            const balances =
              queryClient.getQueryData<Coin[]>(
                accountQueryKeys.balances(chain.restUrl, address).queryKey,
              ) ?? []
            const amount = toBaseUnit(quantity, { decimals })
            const balance = balances.find((balance) => balance.denom === denom)?.amount
            return BigNumber(balance ?? 0).gte(amount)
          }, "Insufficient balance"),
          ["quantity"],
        ),
      ),
    ),
  })

  return (
    <FormProvider {...form}>
      <SendFields />
    </FormProvider>
  )
}

export default Send
