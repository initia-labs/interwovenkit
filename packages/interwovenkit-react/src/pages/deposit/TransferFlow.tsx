import { animated, useTransition } from "@react-spring/web"
import { FormProvider, useForm } from "react-hook-form"
import AnimatedHeight from "@/components/AnimatedHeight"
import { useLocationState } from "@/lib/router"
import {
  type AssetOption,
  type TransferFormValues,
  type TransferMode,
  useAllBalancesQuery,
  useTransferForm,
  useTransferMode,
} from "./hooks"
import SelectExternalAsset from "./SelectExternalAsset"
import SelectLocalAsset from "./SelectLocalAsset"
import { TransferCompleted } from "./TransferCompleted"
import TransferFields from "./TransferFields"
import styles from "./TransferFlow.module.css"

interface Props {
  mode: TransferMode
}

const TransferFlow = ({ mode }: Props) => {
  const { local } = useTransferMode(mode)
  const { localOptions = [] } = useLocationState<{ localOptions?: AssetOption[] }>()

  const defaultValues: TransferFormValues = {
    page: "select-local",
    quantity: "",
    srcDenom: "",
    srcChainId: "",
    dstDenom: "",
    dstChainId: "",
  }

  // With a single local asset there is nothing to pick, so pre-select it and
  // skip the "select-local" page entirely to avoid flashing the asset picker.
  if (localOptions.length === 1) {
    const [{ denom, chainId }] = localOptions
    defaultValues[local.denomKey] = denom
    defaultValues[local.chainIdKey] = chainId
    defaultValues.page = mode === "deposit" ? "select-external" : "fields"
  }

  const form = useForm<TransferFormValues>({ mode: "onChange", defaultValues })

  // prefetch balances
  useAllBalancesQuery()

  return (
    <FormProvider {...form}>
      <TransferFlowRoutes mode={mode} />
    </FormProvider>
  )
}

const TransferFlowRoutes = ({ mode }: Props) => {
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
        return <SelectLocalAsset mode={mode} />
      case "select-external":
        return <SelectExternalAsset mode={mode} />
      case "fields":
        return <TransferFields mode={mode} />
      case "completed":
        return <TransferCompleted type={mode} />
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

export default TransferFlow
