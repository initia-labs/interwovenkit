import { useTransition } from "react"
import SimpleAssetList from "@/components/form/SimpleAssetList"
import { useLocalAssetOptions } from "../data/assetOptions"
import DepositSubpage from "../DepositSubpage"
import { useTransferFlow, useTransferForm, useTransferMode } from "./transferFlowConfig"

const SelectLocalAsset = () => {
  const { mode } = useTransferFlow()
  const { local, external } = useTransferMode()
  const { setValue } = useTransferForm()
  const { data: options } = useLocalAssetOptions()
  const [isPending, startTransition] = useTransition()

  const selectLocalAsset = (denom: string, chain_id: string) => {
    setValue(local.denomKey, denom)
    setValue(local.chainIdKey, chain_id)
    setValue("quantity", "")
    setValue(external.denomKey, "")
    setValue(external.chainIdKey, "")

    // Deferred navigation: keeps showing this page while the next page's
    // suspense resolves, preventing the AsyncBoundary "Loading..." flash.
    startTransition(() => {
      setValue("page", mode === "withdraw" ? "fields" : "select-external")
    })
  }

  if (!options.length) {
    return <div>No assets found</div>
  }

  return (
    <DepositSubpage
      title={mode === "withdraw" ? "Select an asset to withdraw" : "Select an asset to receive"}
    >
      <SimpleAssetList
        assets={options.map(({ denom, chain_id, symbol, logo_uri }) => ({
          denom,
          chainId: chain_id,
          symbol,
          logoUrl: logo_uri,
        }))}
        onSelect={({ denom, chainId }) => selectLocalAsset(denom, chainId)}
        isBusy={isPending}
      />
    </DepositSubpage>
  )
}

export default SelectLocalAsset
