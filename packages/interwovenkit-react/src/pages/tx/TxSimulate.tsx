import clsx from "clsx"
import BigNumber from "bignumber.js"
import { useMemo } from "react"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import type { EncodeObject } from "@cosmjs/proto-signing"
import { useSuspenseQuery } from "@tanstack/react-query"
import { formatAmount, truncate } from "@/public/utils"
import { useHexAddress } from "@/public/data/hooks"
import { STALE_TIMES } from "@/data/http"
import { useTx } from "@/data/tx"
import { useChain } from "@/data/chains"
import { useFindAsset } from "@/data/assets"
import AsyncBoundary from "@/components/AsyncBoundary"
import { calcChangesFromEvents } from "../wallet/tabs/activity/calc"
import WithDenom from "../wallet/tabs/activity/WithDenom"
import WithMoveResource from "../wallet/tabs/assets/WithMoveResource"
import styles from "./TxSimulate.module.css"

function bigintReplacer(_: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value
}

const queryKeys = createQueryKeys("interwovenkit:tx", {
  simulate: (params) => [JSON.stringify(params, bigintReplacer)],
})

interface Props {
  messages: EncodeObject[]
  memo: string
  chainId: string
}

const TxSimulate = ({ messages, memo, chainId }: Props) => {
  const hexAddress = useHexAddress()
  const chain = useChain(chainId)
  const findAsset = useFindAsset(chain)

  const { simulateTx } = useTx()
  const { data: simulated } = useSuspenseQuery({
    queryKey: queryKeys.simulate({ messages, memo, chainId }).queryKey,
    queryFn: () => simulateTx({ messages, memo, chainId }),
    staleTime: STALE_TIMES.SECOND,
  })

  const changes = useMemo(() => {
    if (!simulated) return []
    const fee = { amount: "0", metadata: "" }
    return calcChangesFromEvents(simulated.result?.events ?? [], fee, hexAddress)
  }, [hexAddress, simulated])

  return (
    <div className={styles.changes}>
      {changes.map(({ amount, metadata }, index) => {
        const isPositive = new BigNumber(amount).isPositive()
        const absAmount = new BigNumber(amount).abs().toString()
        return (
          <AsyncBoundary
            suspenseFallback={null}
            errorBoundaryProps={{ fallback: null }}
            key={index}
          >
            <WithDenom metadata={metadata} chain={chain}>
              {(denom) => (
                <WithMoveResource asset={findAsset(denom)} chain={chain}>
                  {({ denom, symbol, decimals }) => (
                    <div
                      className={clsx(
                        styles.change,
                        isPositive ? styles.positive : styles.negative,
                      )}
                    >
                      {isPositive ? "+" : "-"}
                      {formatAmount(absAmount, { decimals })} {symbol ?? truncate(denom)}
                    </div>
                  )}
                </WithMoveResource>
              )}
            </WithDenom>
          </AsyncBoundary>
        )
      })}
    </div>
  )
}

export default TxSimulate
