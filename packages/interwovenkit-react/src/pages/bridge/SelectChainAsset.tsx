import { partition } from "ramda"
import { useState } from "react"
import { useAddress } from "@/public/data/hooks"
import ChainOptions from "@/components/form/ChainOptions"
import { useBridgeForm } from "./data/form"
import { useGetIsInitiaChain, useSkipChain, useSkipChains } from "./data/chains"
import { useGetAddressForBalance } from "./data/address"
import SelectAsset from "./SelectAsset"

interface Props {
  type: "src" | "dst"
  afterSelect: () => void
}

const SelectChainAsset = ({ type, afterSelect }: Props) => {
  const chainIdKey = type === "src" ? "srcChainId" : "dstChainId"
  const denomKey = type === "src" ? "srcDenom" : "dstDenom"
  const addressKey = type === "src" ? "sender" : "recipient"

  const connectedAddress = useAddress()
  const chains = useSkipChains()

  const { watch, setValue, trigger } = useBridgeForm()
  const quantity = watch("quantity")
  const initialAddress = watch(addressKey)
  const initialChainId = watch(chainIdKey)
  const [chainId, setChainId] = useState(initialChainId)
  const chain = useSkipChain(chainId)

  const getAddressForBalance = useGetAddressForBalance()
  const getIsInitiaChain = useGetIsInitiaChain()
  const [internalChains, externalChains] = partition(
    (chain) => getIsInitiaChain(chain.chain_id),
    chains.filter((chain) => !chain.hidden),
  )

  const handleSelect = (denom: string) => {
    setValue(chainIdKey, chainId)
    setValue(denomKey, denom)
    if (Number(quantity)) trigger()
    afterSelect()
  }

  return (
    <>
      <ChainOptions.Stack>
        <ChainOptions
          label="Interwoven Economy"
          chains={internalChains.map(({ chain_id, chain_name, pretty_name, logo_uri }) => {
            return { chainId: chain_id, name: pretty_name || chain_name, logoUrl: logo_uri ?? "" }
          })}
          value={chainId}
          onSelect={setChainId}
        />

        <ChainOptions
          label="Chains"
          chains={externalChains.map(({ chain_id, chain_name, pretty_name, logo_uri }) => {
            return { chainId: chain_id, name: pretty_name || chain_name, logoUrl: logo_uri ?? "" }
          })}
          value={chainId}
          onSelect={setChainId}
        />
      </ChainOptions.Stack>

      <SelectAsset
        address={getAddressForBalance({
          initialAddress,
          initialChainId,
          chainId,
          fallbackAddress: type === "src" ? connectedAddress : undefined,
        })}
        chain={chain}
        onSelect={handleSelect}
      />
    </>
  )
}

export default SelectChainAsset
