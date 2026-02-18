import type { EncodeObject } from "@cosmjs/proto-signing"
import BigNumber from "bignumber.js"
import type { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin"
import { partition } from "ramda"
import { useSuspenseQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { formatAmount, fromBaseUnit } from "@initia/utils"
import type { BaseAsset } from "@/components/form/types"
import Image from "@/components/Image"
import { useFindAsset } from "@/data/assets"
import { type NormalizedChain, useChain, usePricesQuery } from "@/data/chains"
import { STALE_TIMES } from "@/data/http"
import { useTx } from "@/data/tx"
import { formatValue } from "@/lib/format"
import { useInterwovenKit } from "@/public/data/hooks"
import { getCoinChanges, getMoveChanges } from "../wallet/tabs/activity/changes/changes"
import WithDenom from "../wallet/tabs/activity/WithDenom"
import styles from "./TxSimulate.module.css"

import type { ReactNode } from "react"

const Change = ({ amount, asset, price }: { amount: string; asset: BaseAsset; price?: number }) => {
  const { denom, symbol, decimals, logoUrl } = asset
  const formattedAmount = formatAmount(amount, { decimals })
  const value = price && BigNumber(fromBaseUnit(amount, { decimals })).times(price).abs()

  return (
    <div className={styles.change}>
      <div className={styles.amount}>
        <Image src={logoUrl} width={14} height={14} logo />
        <span className={styles.text}>
          {formattedAmount} {symbol || denom}
        </span>
      </div>
      {value && <div className={styles.value}>{formatValue(value)}</div>}
    </div>
  )
}

interface ChangesProps<T> {
  changes: T[]
  chain: NormalizedChain
}

const ChangesWithDenom = ({ changes, chain }: ChangesProps<Coin>) => {
  const findAsset = useFindAsset(chain)
  const { data: prices } = usePricesQuery(chain)

  return changes.map(({ amount, denom }, index) => {
    const asset = findAsset(denom)
    const price = prices?.find(({ id }) => id === denom)?.price
    return <Change amount={amount} asset={asset} price={price} key={index} />
  })
}

const ChangesWithMetadata = ({
  changes,
  chain,
}: ChangesProps<{ amount: string; metadata: string }>) => {
  const findAsset = useFindAsset(chain)
  const { data: prices } = usePricesQuery(chain)

  return changes.map(({ amount, metadata }, index) => {
    return (
      <WithDenom metadata={metadata} chain={chain} key={index}>
        {(denom) => {
          const price = prices?.find(({ id }) => id === denom)?.price
          return <Change amount={amount} asset={findAsset(denom)} price={price} />
        }}
      </WithDenom>
    )
  })
}

interface Props {
  messages: EncodeObject[]
  memo: string
  chainId: string
}

function bigintReplacer(_: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value
}

const queryKeys = createQueryKeys("interwovenkit:tx", {
  simulate: (params) => [JSON.stringify(params, bigintReplacer)],
})

const TxSimulate = ({ messages, memo, chainId }: Props) => {
  const { initiaAddress, hexAddress } = useInterwovenKit()
  const chain = useChain(chainId)

  const { simulateTx } = useTx()
  const { data: simulated } = useSuspenseQuery({
    queryKey: queryKeys.simulate({ messages, memo, chainId }).queryKey,
    queryFn: () => simulateTx({ messages, memo, chainId }),
    staleTime: STALE_TIMES.SECOND,
  })

  const render = (element: ReactNode) => {
    return (
      <div className={styles.root}>
        <h2 className={styles.title}>Estimated changes</h2>
        <div className={styles.changes}>{element}</div>
      </div>
    )
  }

  if (!simulated) return null
  const events = simulated.result?.events ?? []
  if (events.length === 0) return null

  if (chain.metadata?.is_l1 || chain.metadata?.minitia?.type === "minimove") {
    const changes = getMoveChanges(events, hexAddress)
    const [negativeChanges] = splitChanges(changes)
    if (negativeChanges.length === 0) return null
    return render(<ChangesWithMetadata changes={negativeChanges} chain={chain} />)
  }

  const changes = getCoinChanges(events, initiaAddress)
  const [negativeChanges] = splitChanges(changes)
  if (negativeChanges.length === 0) return null
  return render(<ChangesWithDenom changes={negativeChanges} chain={chain} />)
}

export default TxSimulate

function splitChanges<T extends { amount: string }>(changes: T[]) {
  return partition((change) => new BigNumber(change.amount).isNegative(), changes)
}
