import { useState } from "react"
import { useLocationState } from "@/lib/router"
import { useDefaultChain, useFindChain, useInitiaRegistry } from "@/data/chains"
import Page from "@/components/Page"
import FormHelp from "@/components/form/FormHelp"
import AsyncBoundary from "@/components/AsyncBoundary"
import ChainOptions from "@/components/form/ChainOptions"
import WithdrawalList from "./WithdrawalList"
import { useClaimableReminders } from "./reminder"
import styles from "./Withdrawals.module.css"

const Withdrawals = () => {
  const { chainId: initialChainId } = useLocationState<{ chainId?: string }>()
  const chains = useInitiaRegistry()
  const defaultChain = useDefaultChain()
  const [chainId, setChainId] = useState(
    initialChainId ?? (defaultChain.metadata?.is_l1 ? "" : defaultChain.chainId),
  )
  const findChain = useFindChain()
  const { reminders } = useClaimableReminders()
  const chain = chainId ? findChain(chainId) : undefined

  return (
    <Page title="OP Bridge withdrawals">
      <ChainOptions
        chains={chains.filter(({ metadata }) => !metadata?.is_l1 && metadata?.op_denoms?.length)}
        value={chainId}
        onSelect={setChainId}
        getShowIndicator={(chainId) => reminders.some((reminder) => reminder.chainId === chainId)}
      />

      <div className={styles.content}>
        {!chain ? (
          <FormHelp level="info">Select a chain to display your OP Bridge withdrawals</FormHelp>
        ) : (
          <>
            <h2 className={styles.title}>{chain.name}</h2>
            <AsyncBoundary key={chainId}>
              <WithdrawalList chain={chain} />
            </AsyncBoundary>
          </>
        )}
      </div>
    </Page>
  )
}

export default Withdrawals
