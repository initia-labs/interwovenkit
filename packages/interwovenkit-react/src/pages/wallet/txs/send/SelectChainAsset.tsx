import { useState } from "react"
import { useFormContext } from "react-hook-form"
import { useChain, useInitiaRegistry } from "@/data/chains"
import AsyncBoundary from "@/components/AsyncBoundary"
import ChainOptions from "@/components/form/ChainOptions"
import AssetOptions from "@/components/form/AssetOptions"
import type { FormValues } from "./Send"
import SelectAsset from "./SelectAsset"

const SelectChainAsset = ({ afterSelect }: { afterSelect: () => void }) => {
  const { watch, setValue, resetField } = useFormContext<FormValues>()
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
    resetField("quantity")
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
