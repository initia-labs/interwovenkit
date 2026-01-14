import { animated, useTransition } from "@react-spring/web"
import { FormProvider, useForm } from "react-hook-form"
import AnimatedHeight from "@/components/AnimatedHeight"
import { useAllBalancesQuery, useTransferForm } from "./hooks"
import SelectExternalAsset from "./SelectExternalAsset"
import SelectLocalAsset from "./SelectLocalAsset"
import { TransferCompleted } from "./TransferCompleted"
import WithdrawFields from "./WithdrawFields"
import styles from "./Withdraw.module.css"

export interface FormValues {
  page: "select-local" | "select-external" | "fields" | "completed"
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
  const { watch } = useTransferForm()
  const page = watch("page")

  const transition = useTransition(page, {
    keys: page,
    from: { opacity: 0 },
    enter: { opacity: 1 },
    leave: { opacity: 0, position: "absolute" as const, inset: 0 },
    config: { tension: 500, friction: 30, clamp: true, duration: 150 },
  })

  const renderPage = (currentPage: typeof page) => {
    switch (currentPage) {
      case "select-local":
        return <SelectLocalAsset />
      case "select-external":
        return <SelectExternalAsset />
      case "fields":
        return <WithdrawFields />
      case "completed":
        return <TransferCompleted type="withdraw" />
    }
  }

  return (
    <AnimatedHeight>
      <div className={styles.container}>
        {transition((style, currentPage) => (
          <animated.div style={style} className={styles.page}>
            {renderPage(currentPage)}
          </animated.div>
        ))}
      </div>
    </AnimatedHeight>
  )
}

export default Withdraw
