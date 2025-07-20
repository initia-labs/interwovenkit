import clsx from "clsx"
import BigNumber from "bignumber.js"
import { formatAmount, truncate } from "@/public/utils"
import { useHexAddress, useInitiaAddress } from "@/public/data/hooks"
import { useFindAsset } from "@/data/assets"
import type { NormalizedChain } from "@/data/chains"
import AsyncBoundary from "@/components/AsyncBoundary"
import type { BaseAsset } from "@/components/form/types"
import WithMoveResource from "../assets/WithMoveResource"
import { getCoinChanges, getMoveChanges } from "./changes/changes"
import type { TxItem } from "./data"
import WithDenom from "./WithDenom"
import styles from "./ActivityChanges.module.css"

interface Props extends TxItem {
  chain: NormalizedChain
}

const ActivityChange = ({ amount, asset }: { amount: string; asset: BaseAsset }) => {
  const { denom, symbol, decimals } = asset
  const isPositive = new BigNumber(amount).isPositive()
  const absAmount = new BigNumber(amount).abs().toString()

  return (
    <div className={clsx(styles.change, isPositive ? styles.positive : styles.negative)}>
      {isPositive ? "+" : "-"}
      {formatAmount(absAmount, { decimals })} {symbol ?? truncate(denom)}
    </div>
  )
}

const ActivityChangesWithMetadata = ({ events, chain }: Props) => {
  const hexAddress = useHexAddress()
  const findAsset = useFindAsset(chain)

  const changes = getMoveChanges(events, hexAddress)

  return changes.map(({ amount, metadata }, index) => {
    return (
      <AsyncBoundary suspenseFallback={null} errorBoundaryProps={{ fallback: null }} key={index}>
        <WithDenom metadata={metadata} chain={chain}>
          {(denom) => (
            <WithMoveResource asset={findAsset(denom)} chain={chain}>
              {(asset) => <ActivityChange amount={amount} asset={asset} />}
            </WithMoveResource>
          )}
        </WithDenom>
      </AsyncBoundary>
    )
  })
}

const ActivityChangesWithDenom = ({ events, chain }: Props) => {
  const address = useInitiaAddress()
  const changes = getCoinChanges(events, address)
  const findAsset = useFindAsset(chain)

  return changes.map(({ amount, denom }, index) => {
    return (
      <div key={index}>
        <ActivityChange amount={amount} asset={findAsset(denom)} />
      </div>
    )
  })
}

const ActivityChanges = (props: Props) => {
  const { chain } = props

  if (chain.metadata?.is_l1 || chain.metadata?.minitia?.type === "minimove") {
    return <ActivityChangesWithMetadata {...props} />
  }

  return <ActivityChangesWithDenom {...props} />
}

export default ActivityChanges
