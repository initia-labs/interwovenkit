import type { ChainJson } from "@skip-go/client"
import BigNumber from "bignumber.js"
import { ascend, descend, sortWith } from "ramda"
import { truncate } from "@initia/utils"
import AssetOptions from "@/components/form/AssetOptions"
import { useSkipAssets } from "./data/assets"
import { useSkipBalancesQuery } from "./data/balance"

interface Props {
  address: string
  chain: ChainJson
  onSelect: (denom: string) => void
}

const SelectAsset = ({ address, chain, onSelect }: Props) => {
  const assets = useSkipAssets(chain.chain_id)
  const { data: balances = {} } = useSkipBalancesQuery(address, chain.chain_id)

  return (
    <AssetOptions
      assets={sortWith(
        [
          descend((asset) => asset.symbol === "INIT"),
          descend((asset) => asset.value),
          ({ balance: a = "0" }, { balance: b = "0" }) => BigNumber(b).comparedTo(a) ?? 0,
          ascend((asset) => asset.symbol.toLowerCase()),
        ],
        assets
          .filter((asset) => !asset.hidden)
          .map((asset) => {
            const { denom, symbol = truncate(denom), logo_uri } = asset
            const balance = balances[denom] ?? {}
            return {
              ...asset,
              symbol,
              decimals: asset.decimals ?? 0,
              logoUrl: logo_uri ?? "",
              name: asset.name ?? "",
              balance: balance.amount,
              value: Number(balance.value_usd ?? 0),
            }
          }),
      )}
      onSelect={onSelect}
    />
  )
}

export default SelectAsset
