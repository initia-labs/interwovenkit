import { FormProvider, useForm } from "react-hook-form"
import DepositFields from "./DepositFields"
import { useAllBalancesQuery, useDepositForm } from "./hooks"
import SelectExternalAsset from "./SelectExternalAsset"
import SelectLocalAsset from "./SelectLocalAsset"

export interface FormValues {
  page: "select-local" | "select-external" | "fields"
  quantity: string
}

export const Deposit = () => {
  const form = useForm<FormValues>({
    mode: "onChange",
    defaultValues: { page: "select-local", quantity: "" },
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
    case "select-local":
      return <SelectLocalAsset />
    case "select-external":
      return <SelectExternalAsset />
    case "fields":
      return <DepositFields />
  }
}

export default Deposit
