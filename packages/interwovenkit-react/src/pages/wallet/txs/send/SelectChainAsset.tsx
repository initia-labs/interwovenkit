import { useState } from "react"
import { useFormContext } from "react-hook-form"
import AsyncBoundary from "@/components/AsyncBoundary"
import AssetOptions from "@/components/form/AssetOptions"
import ChainOptions from "@/components/form/ChainOptions"
import { useChain, useInitiaRegistry } from "@/data/chains"
import SelectAsset from "./SelectAsset"
import type { FormValues } from "./Send"

const SelectChainAsset = ({ afterSelect }: { afterSelect: () => void }) => {
  const { watch, setValue } = useFormContext<FormValues>()
  const { chainId: currentChainId, denom: currentDenom } = watch()
  const { chainId: defaultChainId } = watch()
  const [chainId, setChainId] = useState(defaultChainId)

  const chain = useChain(chainId)
  const chains = useInitiaRegistry()

  const handleSelect = (denom: string) => {
    if (currentChainId === chainId && currentDenom === denom) {
      afterSelect()
      return
    }

    setValue("chainId", chainId)
    setValue("denom", denom)
    // Use setValue instead of resetField to prevent localStorage values from appearing unexpectedly
    setValue("quantity", "", { shouldTouch: false, shouldDirty: false })
    afterSelect()
  }

  return (
    <>
      <ChainOptions.Stack>
        <ChainOptions chains={chains} value={chainId} onSelect={setChainId} />
      </ChainOptions.Stack>

      <AsyncBoundary suspenseFallback={<AssetOptions.Placeholder />} key={chainId}>
        <SelectAsset chain={chain} onSelect={handleSelect} />
      </AsyncBoundary>
    </>
  )
}

export default SelectChainAsset
