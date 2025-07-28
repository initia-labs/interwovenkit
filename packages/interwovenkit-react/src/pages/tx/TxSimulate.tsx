import BigNumber from "bignumber.js"
import { partition } from "ramda"
import type { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin"
import type { EncodeObject } from "@cosmjs/proto-signing"
import type { ReactNode } from "react"
import { useSuspenseQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { formatAmount, truncate } from "@initia/utils"
import { useInterwovenKit } from "@/public/data/hooks"
import { STALE_TIMES } from "@/data/http"
import { useTx } from "@/data/tx"
import { useChain, type NormalizedChain } from "@/data/chains"
import { useFindAsset } from "@/data/assets"
import type { BaseAsset } from "@/components/form/types"
import Image from "@/components/Image"
import { getCoinChanges, getMoveChanges } from "../wallet/tabs/activity/changes/changes"
import WithDenom from "../wallet/tabs/activity/WithDenom"
import WithMoveResource from "../wallet/tabs/assets/WithMoveResource"
import styles from "./TxSimulate.module.css"

const Change = ({ amount, asset }: { amount: string; asset: BaseAsset }) => {
  const { denom, symbol, decimals, logoUrl } = asset
  const isPositive = new BigNumber(amount).isPositive()
  const absAmount = new BigNumber(amount).abs().toString()

  return (
    <div className={styles.change}>
      {isPositive ? "+" : "-"}
      <Image src={logoUrl} width={14} height={14} />
      {formatAmount(absAmount, { decimals })} {symbol ?? truncate(denom)}
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
        {(denom) => (
          <WithMoveResource asset={findAsset(denom)} chain={chain}>
            {(asset) => <Change amount={amount} asset={asset} />}
          </WithMoveResource>
        )}
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

  const render = (negative: ReactNode, positive: ReactNode) => {
    return (
      <div className={styles.root}>
        <h2 className={styles.title}>Estimated changes</h2>
        <div>
          {negative && (
            <div className={styles.section}>
              <h3 className={styles.label}>Send</h3>
              <div className={styles.changes}>{negative}</div>
            </div>
          )}
          {negative && positive && <div className={styles.divider} />}
          {positive && (
            <div className={styles.section}>
              <h3 className={styles.label}>Receive</h3>
              <div className={styles.changes}>{positive}</div>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (!simulated) return null
  const events = simulated.result?.events ?? []
  if (events.length === 0) return null

  if (chain.metadata?.is_l1 || chain.metadata?.minitia?.type === "minimove") {
    const changes = getMoveChanges(events, hexAddress)
    if (changes.length === 0) return null

    const [negativeChanges, positiveChanges] = splitChanges(changes)

    return render(
      // Only render Send section if there are outgoing changes (negative amounts)
      negativeChanges.length > 0 && <ChangesWithMetadata changes={negativeChanges} chain={chain} />,
      // Only render Receive section if there are incoming changes (positive amounts)
      positiveChanges.length > 0 && <ChangesWithMetadata changes={positiveChanges} chain={chain} />,
    )
  }

  const changes = getCoinChanges(events, initiaAddress)
  if (changes.length === 0) return null

  const [negativeChanges, positiveChanges] = splitChanges(changes)

  return render(
    // Only render Send section if there are outgoing changes (negative amounts)
    negativeChanges.length > 0 && <ChangesWithDenom changes={negativeChanges} chain={chain} />,
    // Only render Receive section if there are incoming changes (positive amounts)
    positiveChanges.length > 0 && <ChangesWithDenom changes={positiveChanges} chain={chain} />,
  )
}

export default TxSimulate

function splitChanges<T extends { amount: string }>(changes: T[]) {
  return partition((change) => new BigNumber(change.amount).isNegative(), changes)
}
