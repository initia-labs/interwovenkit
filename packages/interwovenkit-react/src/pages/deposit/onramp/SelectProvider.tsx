import clsx from "clsx"
import { formatNumber } from "@initia/utils"
import { useDepositForm, useDepositNavigate } from "../context"
import DepositStatus from "../DepositStatus"
import DepositSubpage from "../DepositSubpage"
import { useOnrampsMetadata } from "./data/onramper"
import { getOnrampDisplayName } from "./data/onramperLogic"
import ProviderLogo from "./ProviderLogo"
import { useOnrampQuote } from "./quote"
import styles from "./SelectProvider.module.css"

/** Provider comparison: one row per Onramper quote, ranked by payout.
 * The best provider is flagged; others show their percentage gap against it. */
const SelectProvider = () => {
  const { watch, setValue } = useDepositForm()
  const navigate = useDepositNavigate()
  const receiveSymbol = watch("receiveSymbol")
  const providerId = watch("providerId")
  const quote = useOnrampQuote()
  const onramps = useOnrampsMetadata()

  const renderList = () => {
    if (quote.status === "loading") return <DepositStatus>Loading…</DepositStatus>
    // Surface the quotes failure itself: an API outage or rate limit must not
    // read as "no provider made an offer".
    if (quote.status === "error") return <DepositStatus>{quote.message}</DepositStatus>
    // Surface the no-offers reason (a provider's amount-range guidance, else
    // widget copy — see quotesErrorMessage) so the state doesn't read as a bug.
    if (quote.status === "no-offers") return <DepositStatus>{quote.reason}</DepositStatus>
    if (quote.status !== "quoted") return <DepositStatus>No quotes available</DepositStatus>
    return quote.ranked.map((entry) => (
      <DepositSubpage.Row
        key={entry.ramp}
        isActive={providerId === entry.ramp}
        onClick={() => {
          setValue("providerId", entry.ramp)
          navigate("onramp")
        }}
      >
        <span className={styles.left}>
          <ProviderLogo ramp={entry.ramp} size={28} />
          <span className={styles.name}>{getOnrampDisplayName(onramps, entry.ramp)}</span>
          {entry.isBest && (
            <span className={clsx(styles.badge, styles.badgeSuccess)}>Best price</span>
          )}
        </span>

        <span className={styles.right}>
          <span className={styles.amount}>
            {formatNumber(String(entry.payout), { dp: 6 })} {receiveSymbol}
          </span>
          {entry.diffLabel && <span className={styles.diff}>{entry.diffLabel}</span>}
        </span>
      </DepositSubpage.Row>
    ))
  }

  return (
    <DepositSubpage title="Select provider" onBack={() => navigate("onramp")}>
      <div className={styles.header}>
        <span>Provider</span>
        <span>You receive</span>
      </div>

      <DepositSubpage.List>{renderList()}</DepositSubpage.List>
    </DepositSubpage>
  )
}

export default SelectProvider
