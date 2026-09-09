import type { AssetOption } from "../data/assetOptions"
import {
  getTransferModeConfig,
  type TransferFormValues,
  type TransferMode,
} from "./transferFlowConfig"

/**
 * Initial transfer form values. The local asset is preset (skipping the
 * select-local page) when the deposit hub already picked one (`initialAsset`)
 * or when the host provided a single local option — there is nothing to pick,
 * and showing the picker would only flash. Deposit then starts at
 * select-external (the source is still unknown); withdraw starts at fields.
 */
export function buildTransferDefaultValues({
  mode,
  initialAsset,
  localOptions,
}: {
  mode: TransferMode
  initialAsset?: AssetOption
  localOptions: AssetOption[]
}): TransferFormValues {
  const { local } = getTransferModeConfig(mode)

  const defaultValues: TransferFormValues = {
    page: "select-local",
    quantity: "",
    srcDenom: "",
    srcChainId: "",
    dstDenom: "",
    dstChainId: "",
  }

  const preset = initialAsset ?? (localOptions.length === 1 ? localOptions[0] : undefined)
  if (preset) {
    defaultValues[local.denomKey] = preset.denom
    defaultValues[local.chainIdKey] = preset.chainId
    defaultValues.page = mode === "deposit" ? "select-external" : "fields"
  }

  return defaultValues
}
