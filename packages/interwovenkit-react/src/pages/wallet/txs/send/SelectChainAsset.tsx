import { useState } from "react"
import { useFormContext } from "react-hook-form"
import { useChain, useManageChains } from "@/data/chains"
import AsyncBoundary from "@/components/AsyncBoundary"
import ChainOptions from "@/components/form/ChainOptions"
import AssetOptions from "@/components/form/AssetOptions"
import type { FormValues } from "./Send"
import SelectAsset from "./SelectAsset"

const SelectChainAsset = ({ afterSelect }: { afterSelect: () => void }) => {
  const { watch, setValue } = useFormContext<FormValues>()
  const { chainId: defaultChainId } = watch()
  const [chainId, setChainId] = useState(defaultChainId)

  const chain = useChain(chainId)
  const { addedChains } = useManageChains()

  const handleSelect = (denom: string) => {
    setValue("chainId", chainId)
    setValue("denom", denom)
    afterSelect()
  }

  return (
    <>
      {addedChains.length > 1 && (
        <ChainOptions.Stack>
          <ChainOptions chains={addedChains} value={chainId} onSelect={setChainId} />
        </ChainOptions.Stack>
      )}

      <AsyncBoundary suspenseFallback={<AssetOptions.Placeholder />} key={chainId}>
        <SelectAsset chain={chain} onSelect={handleSelect} />
      </AsyncBoundary>
    </>
  )
}

export default SelectChainAsset
