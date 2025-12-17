import { FormProvider, useForm } from "react-hook-form"
import DepositFields from "./DepositFields"
import {
  useAllBalancesQuery,
  useDepositForm,
  useDepositOptions,
  useDstDepositAsset,
  useSrcDepositAsset,
} from "./hooks"
import SelectDstAsset from "./SelectDstAsset"
import SelectSrcAsset from "./SelectSrcAsset"

export interface FormValues {
  quantity: string
}

export const Deposit = () => {
  const form = useForm<FormValues>({
    mode: "onChange",
    defaultValues: { quantity: "" },
  })

  // prefetch balances
  useAllBalancesQuery()

  return (
    <FormProvider {...form}>
      <DepositRoutes />
    </FormProvider>
  )
}

const DepositRoutes = () => {
  const options = useDepositOptions()
  const dstAsset = useDstDepositAsset()
  const srcAsset = useSrcDepositAsset()
  const { setValue } = useDepositForm()

  if (!dstAsset) {
    if (options.length === 1) {
      setValue("dstDenom", options[0].denom)
      setValue("dstChainId", options[0].chain_id)
      return null
    }
    return <SelectDstAsset options={options} />
  }

  if (!srcAsset) return <SelectSrcAsset />

  return <DepositFields />
}

export default Deposit
