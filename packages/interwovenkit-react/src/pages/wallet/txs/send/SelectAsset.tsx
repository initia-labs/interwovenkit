import type { NormalizedChain } from "@/data/chains"
import { useSortedBalancesWithValue } from "@/data/account"
import AssetOptions from "@/components/form/AssetOptions"

interface Props {
  chain: NormalizedChain
  onSelect: (denom: string) => void
}

const SelectAsset = ({ chain, onSelect }: Props) => {
  const balances = useSortedBalancesWithValue(chain)
  return <AssetOptions assets={balances} onSelect={onSelect} />
}

export default SelectAsset
