import clsx from "clsx"
import BigNumber from "bignumber.js"
import type { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin"
import { formatAmount } from "@initia/utils"
import { useInterwovenKit } from "@/public/data/hooks"
import { useFindAsset } from "@/data/assets"
import type { NormalizedChain } from "@/data/chains"
import type { BaseAsset } from "@/components/form/types"
import { getCoinChanges, getMoveChanges } from "./changes/changes"
import type { TxItem } from "./queries"
import WithDenom from "./WithDenom"
import styles from "./ActivityChanges.module.css"

const Change = ({ amount, asset }: { amount: string; asset: BaseAsset }) => {
  const { denom, symbol, decimals } = asset
  const isPositive = new BigNumber(amount).isPositive()
  const absAmount = new BigNumber(amount).abs().toString()

  return (
    <div className={clsx(styles.change, isPositive ? styles.positive : styles.negative)}>
      {isPositive ? "+" : "-"}
      {formatAmount(absAmount, { decimals })} {symbol || denom}
    </div>
  )
}

interface ChangesProps<T> {
  changes: T[]
  chain: NormalizedChain
}

const ChangesWithDenom = ({ changes, chain }: ChangesProps<Coin>) => {
  const findAsset = useFindAsset(chain)

  return changes.map(({ amount, denom }, index) => (
    <Change amount={amount} asset={findAsset(denom)} key={index} />
  ))
}

const ChangesWithMetadata = ({
  changes,
  chain,
}: ChangesProps<{ amount: string; metadata: string }>) => {
  const findAsset = useFindAsset(chain)

  return changes.map(({ amount, metadata }, index) => {
    return (
      <WithDenom metadata={metadata} chain={chain} key={index}>
        {(denom) => <Change amount={amount} asset={findAsset(denom)} />}
      </WithDenom>
    )
  })
}

interface Props extends TxItem {
  chain: NormalizedChain
}

const ActivityChanges = ({ events, chain }: Props) => {
  const { initiaAddress, hexAddress } = useInterwovenKit()

  if (chain.metadata?.is_l1 || chain.metadata?.minitia?.type === "minimove") {
    return <ChangesWithMetadata changes={getMoveChanges(events, hexAddress)} chain={chain} />
  }

  return <ChangesWithDenom changes={getCoinChanges(events, initiaAddress)} chain={chain} />
}

export default ActivityChanges
