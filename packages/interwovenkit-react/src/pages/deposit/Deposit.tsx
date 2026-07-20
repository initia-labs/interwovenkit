// Deposit flow: single /deposit route driven by a React Hook Form `page` field.
// An asset picker feeds the method hub (deposit via wallet / deposit via
// address / buy with cash/card), and each method renders as a page of this hub
// form.
import { useEffect } from "react"
import { FormProvider, useForm } from "react-hook-form"
import AnimatedHeight from "@/components/AnimatedHeight"
import { LocalStorageKey } from "@/data/constants"
import { useLocationState } from "@/lib/router"
import DepositAddress from "./address/DepositAddress"
import { type DepositLocationState, useLocalAssetOptions } from "./data/assetOptions"
import OnrampFields from "./onramp/OnrampFields"
import OnrampProcessing from "./onramp/OnrampProcessing"
import SelectFiat from "./onramp/SelectFiat"
import SelectPaymentMethod from "./onramp/SelectPaymentMethod"
import SelectProvider from "./onramp/SelectProvider"
import SelectReceiveChainAsset from "./onramp/SelectReceiveChainAsset"
import TransferFlow from "./wallet/TransferFlow"
import { type DepositFormValues, useDepositForm, useDepositNavigate } from "./context"
import { buildDepositDefaultValues } from "./defaultValues"
import DepositPageTransition from "./DepositPageTransition"
import DepositSurface from "./DepositSurface"
import DepositTracking from "./DepositTracking"
import SelectAsset from "./SelectAsset"
import SelectDepositMethod from "./SelectDepositMethod"

const Deposit = () => {
  const { localOptions = [] } = useLocationState<DepositLocationState>()
  const form = useForm<DepositFormValues>({
    mode: "onChange",
    defaultValues: buildDepositDefaultValues(localOptions, {
      paymentMethodId: localStorage.getItem(LocalStorageKey.ONRAMP_PAYMENT_TYPE_ID),
      fiatId: localStorage.getItem(LocalStorageKey.ONRAMP_FIAT_ID),
    }),
  })

  return (
    <FormProvider {...form}>
      <SyncReceiveSymbol />
      <DepositRoutes />
    </FormProvider>
  )
}

/**
 * Fills `receiveSymbol` when the asset picker was skipped: the preset is only a
 * (denom, chainId) pair, and the symbol resolves asynchronously from Skip (or
 * the registry cache).
 *
 * `receiveSymbol` is deliberately a form field, not derived on read: the two
 * pickers resolve symbols from different datasets (SelectAsset from
 * Skip/registry, the onramp receive picker from the Deposit API's
 * `config/assets`), and downstream screens must keep showing the picked symbol
 * even after those sources refetch, fail, or drop the route. The form field
 * snapshots it once at selection time; this effect only covers the preset path,
 * where no selection event exists to capture it.
 */
const SyncReceiveSymbol = () => {
  const { watch, setValue } = useDepositForm()
  const receiveSymbol = watch("receiveSymbol")
  const receiveDenom = watch("receiveDenom")
  const receiveChainId = watch("receiveChainId")
  const { data: options, isLoading, error } = useLocalAssetOptions()
  const resolvedSymbol = options.find(
    ({ denom, chain_id }) => denom === receiveDenom && chain_id === receiveChainId,
  )?.symbol

  useEffect(() => {
    if (receiveSymbol || !resolvedSymbol) return
    setValue("receiveSymbol", resolvedSymbol)
  }, [receiveSymbol, resolvedSymbol, setValue])

  // A preset asset whose symbol can never resolve — the metadata query failed,
  // or it settled without listing the host-passed denom — would leave
  // downstream screens showing a blank name. Throw to the modal's AsyncBoundary
  // (message + retry) instead.
  if (receiveDenom && !receiveSymbol && !resolvedSymbol && !isLoading) {
    if (error) throw error
    throw new Error(`Asset metadata not found for ${receiveDenom} on ${receiveChainId}`)
  }

  return null
}

const DepositRoutes = () => {
  const { watch } = useDepositForm()
  const page = watch("page")

  const renderPageContent = (currentPage: DepositFormValues["page"]) => {
    switch (currentPage) {
      case "select-asset":
        return <SelectAsset />
      case "select-method":
        return <SelectDepositMethod />
      case "wallet":
        return <WalletFlow />
      case "address":
        return <DepositAddress />
      case "track":
        return <DepositTracking />
      case "onramp":
        return <OnrampFields />
      case "onramp-select-fiat":
        return <SelectFiat />
      case "onramp-select-receive":
        return <SelectReceiveChainAsset />
      case "onramp-select-payment":
        return <SelectPaymentMethod />
      case "onramp-select-provider":
        return <SelectProvider />
      case "onramp-processing":
        return <OnrampProcessing />
    }
  }

  // The wallet page hosts the nested TransferFlow, whose own pages each bring
  // their DepositSurface — it renders without one so the surface is not
  // doubled.
  const renderPage = (currentPage: DepositFormValues["page"]) =>
    currentPage === "wallet" ? (
      renderPageContent(currentPage)
    ) : (
      <DepositSurface>{renderPageContent(currentPage)}</DepositSurface>
    )

  return (
    <AnimatedHeight>
      <DepositPageTransition page={page} renderPage={renderPage} />
    </AnimatedHeight>
  )
}

/**
 * "Deposit via wallet" method: the existing Router API transfer flow embedded
 * as a hub page. The hub's asset choice presets the destination, so the flow
 * starts at select-external; leaving backward returns to the method hub.
 */
const WalletFlow = () => {
  const { watch } = useDepositForm()
  const navigate = useDepositNavigate()
  const receiveDenom = watch("receiveDenom")
  const receiveChainId = watch("receiveChainId")

  return (
    <TransferFlow
      mode="deposit"
      initialAsset={{ denom: receiveDenom, chainId: receiveChainId }}
      onExit={() => navigate("select-method")}
    />
  )
}

export default Deposit
