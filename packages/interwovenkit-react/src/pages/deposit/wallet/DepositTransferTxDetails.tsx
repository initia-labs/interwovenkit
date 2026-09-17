import { Fragment } from "react"
import { IconChevronRight } from "@initia/icons-react"
import { formatAmount, truncate } from "@initia/utils"
import DetailRow from "@/components/DetailRow"
import Image from "@/components/Image"
import { useConfig } from "@/data/config"
import { UNKNOWN_VALUE } from "@/data/constants"
import { useConnectedWalletIcon } from "@/hooks/useConnectedWalletIcon"
import { formatDuration } from "@/pages/bridge/data/format"
import { getBridgeToolDisplay } from "./depositSources"
import { combineEstimatedSeconds, formatNetworkFee } from "./depositTransferLogic"
import { TransferTxDetailsBody } from "./TransferTxDetails"
import type { DepositTransferModel } from "./useDepositTransfer"
import styles from "./TransferTxDetails.module.css"

// One fee row only: the quoted `amount_out` is already net of the bridge's own
// effects, so a "bridge fee" row would count the same cost twice.
const DepositTransferTxDetails = ({ model }: { model: DepositTransferModel }) => {
  const { registryUrl } = useConfig()
  const walletIcon = useConnectedWalletIcon()
  const { transport, quote, route, destination, estimatedAmountOut, recipient, isHostRecipient } =
    model

  const tool = quote ? getBridgeToolDisplay(quote.tool) : undefined
  const destinationLogo = `${registryUrl}/images/${route.dst_symbol}.png`
  // Every leg must be known for the total to mean anything (combineEstimatedSeconds).
  const estimatedSeconds = combineEstimatedSeconds(
    transport === "lifi"
      ? [quote?.estimate.execution_duration_seconds, destination.processing_time_seconds]
      : [destination.processing_time_seconds],
  )
  // Every route carries the Ethereum → Initia leg, so the Router path's long-duration
  // warning color would apply to all of them and is not used here.
  const estimatedTime = estimatedSeconds ? formatDuration(estimatedSeconds) : undefined
  const providerRow = transport === "lifi" && tool && model.openRouteSelection && (
    <DetailRow label="Provider">
      <button
        type="button"
        className={styles.provider}
        onClick={model.openRouteSelection}
        disabled={model.isSubmitting}
      >
        <Image src={tool.logoUrl} alt={tool.name} width={14} height={14} logo /> {tool.name}
        <span className={styles.muted}> · {estimatedTime || UNKNOWN_VALUE}</span>
        <IconChevronRight size={12} aria-hidden="true" />
      </button>
    </DetailRow>
  )

  return (
    <TransferTxDetailsBody
      before={providerRow}
      estimatedTime={providerRow ? undefined : estimatedTime || UNKNOWN_VALUE}
      estimatedReceived={
        estimatedAmountOut ? (
          <>
            <Image
              src={destinationLogo}
              alt={route.dst_symbol}
              className={styles.token}
              width={14}
              height={14}
            />{" "}
            {formatAmount(estimatedAmountOut, { decimals: destination.decimals })}{" "}
            {route.dst_symbol}
          </>
        ) : (
          UNKNOWN_VALUE
        )
      }
    >
      {/* The row's own value is already a flex line, so the legs need no wrapper. */}
      <DetailRow label="Route">
        {model.legs.map((leg, index) => (
          <Fragment key={leg.name}>
            {index > 0 && <IconChevronRight size={10} aria-hidden="true" />}
            <Image src={leg.logoUrl} alt={leg.name} width={14} height={14} logo /> {leg.name}
          </Fragment>
        ))}
      </DetailRow>

      <DetailRow label="Network fee">{formatNetworkFee(quote?.estimate.gas_cost_usd)}</DetailRow>

      {/* A bridge's messaging fee travels as the call's native value, in ETH even
          for a USDC deposit, and is not part of the quoted output. */}
      {quote && BigInt(quote.transaction.value) > 0n && (
        <DetailRow label="Protocol fee">
          {formatAmount(quote.transaction.value, { decimals: 18 })} {model.nativeSymbol}
        </DetailRow>
      )}

      {/* A host-set recipient is not the connected wallet, so no wallet icon. */}
      <DetailRow label={isHostRecipient ? "Recipient (set by app)" : "Receiving address"}>
        {!isHostRecipient && <img src={walletIcon} alt="Wallet" height={12} width={12} />}{" "}
        {truncate(recipient)}
      </DetailRow>
    </TransferTxDetailsBody>
  )
}

export default DepositTransferTxDetails
