import AssetOptions from "@/components/form/AssetOptions"
import { useSortedBalancesWithValue } from "@/data/account"
import type { NormalizedChain } from "@/data/chains"

interface Props {
  chain: NormalizedChain
  onSelect: (denom: string) => void
}

const SelectAsset = ({ chain, onSelect }: Props) => {
  const balances = useSortedBalancesWithValue(chain)
  return <AssetOptions assets={balances} onSelect={onSelect} />
}

export default SelectAsset
