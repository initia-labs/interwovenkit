import { useMemo } from "react"
import { FormProvider, useForm } from "react-hook-form"
import AnimatedHeight from "@/components/AnimatedHeight"
import { useLocationState } from "@/lib/router"
import type { AssetOption, DepositLocationState } from "../data/assetOptions"
import DepositPageTransition from "../DepositPageTransition"
import DepositSurface from "../DepositSurface"
import { useAllBalancesQuery } from "./balances"
import { buildTransferDefaultValues } from "./defaultValues"
import SelectExternalAsset from "./SelectExternalAsset"
import SelectLocalAsset from "./SelectLocalAsset"
import { TransferCompleted } from "./TransferCompleted"
import TransferFields from "./TransferFields"
import {
  TransferFlowContext,
  type TransferFormValues,
  type TransferMode,
  useTransferForm,
} from "./transferFlowConfig"

interface Props {
  mode: TransferMode
  /** The local asset chosen upstream (the deposit hub). Presets it and starts
   * the flow at select-external — the select-local page is never shown. */
  initialAsset?: AssetOption
  /** Exit backward out of this flow (to the deposit hub). When set, the flow is
   * embedded: back boundaries that would otherwise go to select-local call this
   * instead, and the outer AnimatedHeight is skipped (the hub already animates
   * height). */
  onExit?: () => void
}

const TransferFlow = ({ mode, initialAsset, onExit }: Props) => {
  const { localOptions = [] } = useLocationState<DepositLocationState>()
  const form = useForm<TransferFormValues>({
    mode: "onChange",
    defaultValues: buildTransferDefaultValues({ mode, initialAsset, localOptions }),
  })

  // prefetch balances
  useAllBalancesQuery()

  const flowConfig = useMemo(() => ({ mode, onExit }), [mode, onExit])
  const routes = <TransferFlowRoutes />

  return (
    <TransferFlowContext.Provider value={flowConfig}>
      <FormProvider {...form}>
        {onExit ? routes : <AnimatedHeight>{routes}</AnimatedHeight>}
      </FormProvider>
    </TransferFlowContext.Provider>
  )
}

const TransferFlowRoutes = () => {
  const { watch } = useTransferForm()
  const page = watch("page")

  const renderPageContent = (currentPage: typeof page) => {
    switch (currentPage) {
      case "select-local":
        return <SelectLocalAsset />
      case "select-external":
        return <SelectExternalAsset />
      case "fields":
        return <TransferFields />
      case "completed":
        return <TransferCompleted />
    }
  }

  return (
    <DepositPageTransition
      page={page}
      renderPage={(currentPage) => (
        <DepositSurface>{renderPageContent(currentPage)}</DepositSurface>
      )}
    />
  )
}

export default TransferFlow
