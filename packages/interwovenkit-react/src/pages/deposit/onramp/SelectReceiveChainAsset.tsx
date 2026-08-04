import { descend, sortWith } from "ramda"
import { formatAmount } from "@initia/utils"
import ChainAssetListItem from "@/components/form/ChainAssetListItem"
import { usePortfolio } from "@/data/portfolio"
import { formatValueWithPrice } from "@/lib/format"
import { useLocationState } from "@/lib/router"
import type { DepositLocationState } from "../data/assetOptions"
import { normalizeDenom } from "../data/assetOptions"
import { useReceiveAssets } from "../data/assets"
import { useDepositForm, useDepositNavigate } from "../context"
import DepositSubpage from "../DepositSubpage"

/** Receive-asset picker by destination chain, opened from the Receive pill.
 * Selecting refines the symbol and chain, then returns. Rows carry the user's
 * holdings (balance and USD value) from the wallet portfolio; rows with no
 * balance (zero or still loading) render without the columns.
 *
 * The options are the intersection of the Deposit API's `chainAssets` (every
 * purchasable destination) with the host dApp's `openDeposit({ denoms })` list,
 * so a pick here can never leave the scope the host declared. */
const SelectReceiveChainAsset = () => {
  const { watch, setValue } = useDepositForm()
  const navigate = useDepositNavigate()
  const { chainAssets: allChainAssets } = useReceiveAssets()
  const { localOptions = [] } = useLocationState<DepositLocationState>()
  const chainAssets = allChainAssets.filter((asset) =>
    localOptions.some(
      (option) =>
        option.chainId === asset.chainId &&
        normalizeDenom(option.denom) === normalizeDenom(asset.denom),
    ),
  )

  // Holdings per (chain, denom) from the shared portfolio queries (cached with
  // the wallet page). The portfolio lists positive balances only, so a missing
  // item simply means "nothing to show" — the row renders without columns.
  const { assetGroups, unlistedAssets } = usePortfolio()
  const holdings = [...assetGroups.flatMap((group) => group.assets), ...unlistedAssets]
  // portfolio vs Deposit API `config/assets` casing — see normalizeDenom
  const findHolding = (chainId: string, denom: string) =>
    holdings.find(
      (item) =>
        item.chain.chainId === chainId && normalizeDenom(item.denom) === normalizeDenom(denom),
    )

  // Highest value first; ties (including no-balance rows at 0)
  // keep the Deposit API's `config/assets` order via the stable sort.
  const sortedChainAssets = sortWith(
    [descend((asset) => findHolding(asset.chainId, asset.denom)?.value ?? 0)],
    chainAssets,
  )

  const receiveDenom = watch("receiveDenom")
  const receiveChainId = watch("receiveChainId")

  return (
    <DepositSubpage title="Select receive assets" onBack={() => navigate("onramp")}>
      <DepositSubpage.List>
        {sortedChainAssets.map((asset) => {
          const holding = findHolding(asset.chainId, asset.denom)
          return (
            <ChainAssetListItem
              key={`${asset.chainId}-${asset.denom}`}
              assetLogoUrl={asset.logoUrl}
              assetSymbol={asset.symbol}
              chainLogoUrl={asset.chainLogoUrl}
              chainName={asset.chainName}
              chainPrettyName={asset.chainName}
              isActive={
                normalizeDenom(receiveDenom) === normalizeDenom(asset.denom) &&
                receiveChainId === asset.chainId
              }
              onClick={() => {
                setValue("receiveSymbol", asset.symbol)
                setValue("receiveDenom", asset.denom)
                setValue("receiveChainId", asset.chainId)
                navigate("onramp")
              }}
              balanceLabel={
                holding ? formatAmount(holding.amount, { decimals: holding.decimals }) : undefined
              }
              valueLabel={holding ? formatValueWithPrice(holding.value, holding.price) : undefined}
            />
          )
        })}
      </DepositSubpage.List>
    </DepositSubpage>
  )
}

export default SelectReceiveChainAsset
