import { FormProvider, useForm } from "react-hook-form"
import DepositFields from "./DepositFields"

export interface FormValues {
  quantity: string
}

export const Deposit = () => {
  const form = useForm<FormValues>({
    mode: "onChange",
    defaultValues: { quantity: "" },
  })

  return (
    <FormProvider {...form}>
      <DepositFields />
    </FormProvider>
  )
}

export default Deposit
