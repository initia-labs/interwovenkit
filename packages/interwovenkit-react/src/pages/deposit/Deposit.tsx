import { animated, useTransition } from "@react-spring/web"
import { FormProvider, useForm } from "react-hook-form"
import AnimatedHeight from "../../components/AnimatedHeight"
import DepositFields from "./DepositFields"
import { useAllBalancesQuery, useDepositForm } from "./hooks"
import SelectExternalAsset from "./SelectExternalAsset"
import SelectLocalAsset from "./SelectLocalAsset"
import styles from "./Deposit.module.css"

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

  const transition = useTransition(page, {
    keys: page,
    from: { opacity: 1 },
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
        return <DepositFields />
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

export default Deposit
