import { FormProvider, useForm } from "react-hook-form"
import DepositFields from "./DepositFields"
import { useAllBalancesQuery, useDepositForm } from "./hooks"
import SelectDstAsset from "./SelectDstAsset"
import SelectSrcAsset from "./SelectSrcAsset"

export interface FormValues {
  page: "select-dst" | "select-src" | "fields"
  quantity: string
}

export const Deposit = () => {
  const form = useForm<FormValues>({
    mode: "onChange",
    defaultValues: { page: "select-dst", quantity: "" },
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
  const { watch } = useDepositForm()
  const page = watch("page")

  switch (page) {
    case "select-dst":
      return <SelectDstAsset />
    case "select-src":
      return <SelectSrcAsset />
    case "fields":
      return <DepositFields />
  }
}

export default Deposit
