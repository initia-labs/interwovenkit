import { FormProvider, useForm } from "react-hook-form"
import { useAllBalancesQuery, useWithdrawForm } from "./hooks"
import SelectExternalAsset from "./SelectExternalAsset"
import SelectLocalAsset from "./SelectLocalAsset"
import WithdrawFields from "./WithdrawFields"

export interface FormValues {
  page: "select-local" | "select-external" | "fields"
  quantity: string
}

export const Withdraw = () => {
  const form = useForm<FormValues>({
    mode: "onChange",
    defaultValues: { page: "select-local", quantity: "" },
  })

  // prefetch balances
  useAllBalancesQuery()

  return (
    <FormProvider {...form}>
      <WithdrawRoutes />
    </FormProvider>
  )
}

const WithdrawRoutes = () => {
  const { watch } = useWithdrawForm()
  const page = watch("page")

  switch (page) {
    case "select-local":
      return <SelectLocalAsset />
    case "select-external":
      return <SelectExternalAsset />
    case "fields":
      return <WithdrawFields />
  }
}

export default Withdraw
