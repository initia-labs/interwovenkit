import { Fragment } from "react"
import { IconChevronRight } from "@initia/icons-react"
import { formatAmount, truncate } from "@initia/utils"
import Collapsible from "@/components/Collapsible"
import DetailRow from "@/components/DetailRow"
import Image from "@/components/Image"
import { useConfig } from "@/data/config"
import { useConnectedWalletIcon } from "@/hooks/useConnectedWalletIcon"
import { useLocationState } from "@/lib/router"
import { useAllSkipAssets } from "@/pages/bridge/data/assets"
import { calculateMinimumReceived, formatDuration, formatFees } from "@/pages/bridge/data/format"
import type { RouterRouteResponseJson } from "@/pages/bridge/data/simulate"
import { useBridgePreviewState } from "@/pages/bridge/data/tx"
import { useInitiaAddress } from "@/public/data/hooks"
import { normalizeDenom } from "../data/assetOptions"
import { getBridgeToolDisplay } from "./depositSources"
import { combineEstimatedSeconds, formatNetworkFee } from "./depositTransferLogic"
import type { DepositTransferModel } from "./useDepositTransfer"
import styles from "./TransferTxDetails.module.css"

import type { CSSProperties, ReactNode } from "react"

interface BodyProps {
  /** Rows inside the collapsible "Transaction details" section. */
  children: ReactNode
  /** Rows that stay visible above the collapsible (the provider choice). */
  before?: ReactNode
  /** Omitted when another row (the provider) already carries the total. */
  estimatedTime?: ReactNode
  estimatedTimeStyle?: CSSProperties
  estimatedReceived: ReactNode
}

/**
 * The details block's presentation, with no opinion about where the numbers come
 * from. Both the Router preview and the Deposit API controller feed it, so the
 * two paths cannot drift into different hierarchies: the estimate rows stay
 * outside the collapsible, where they are the one thing always visible.
 */
export const TransferTxDetailsBody = ({
  children,
  before,
  estimatedTime,
  estimatedTimeStyle,
  estimatedReceived,
}: BodyProps) => {
  return (
    <div className={styles.container}>
      {before}
      <Collapsible title="Transaction details">{children}</Collapsible>

      {estimatedTime !== undefined && (
        <DetailRow label="Estimated time" valueStyle={estimatedTimeStyle}>
          {estimatedTime}
        </DetailRow>
      )}
      <DetailRow label="Estimated received" emphasized>
        {estimatedReceived}
      </DetailRow>
    </div>
  )
}

/** Value unknown: shown as a dash, never as zero or "instant". */
const UNKNOWN = "—"

const LONG_DURATION_SECONDS = 60

interface Props {
  renderFee?: (() => React.ReactNode) | undefined
}

const TransferTxDetails = ({ renderFee }: Props) => {
  const { route } = useLocationState<{ route?: RouterRouteResponseJson }>()
  const { values } = useBridgePreviewState()
  const { dstDenom, dstChainId } = values
  const skipAssets = useAllSkipAssets()
  // `dstDenom` may carry the host-provided casing (see useLocalTransferAsset);
  // a raw compare would miss and silently drop the whole details block.
  const dstAsset = skipAssets.find(
    ({ denom, chain_id }) =>
      normalizeDenom(denom) === normalizeDenom(dstDenom) && chain_id === dstChainId,
  )
  const address = useInitiaAddress()
  const walletIcon = useConnectedWalletIcon()

  const isLongDuration = route && route.estimated_route_duration_seconds > LONG_DURATION_SECONDS

  if (!route || !dstAsset) return null

  const minimumReceived = calculateMinimumReceived(route.amount_out, values.slippagePercent)

  return (
    <TransferTxDetailsBody
      estimatedTime={formatDuration(route.estimated_route_duration_seconds)}
      estimatedTimeStyle={isLongDuration ? { color: "var(--warning)" } : undefined}
      estimatedReceived={
        <>
          <img src={dstAsset.logo_uri} alt={dstAsset.symbol} className={styles.token} />{" "}
          {formatAmount(route.amount_out, { decimals: dstAsset.decimals })} {dstAsset.symbol}
        </>
      }
    >
      {route.does_swap && <DetailRow label="Slippage">{values.slippagePercent}%</DetailRow>}
      {!!route.estimated_fees?.length && (
        <DetailRow label="Bridge fee">{formatFees(route.estimated_fees)}</DetailRow>
      )}
      {renderFee && <DetailRow label="Tx fee">{renderFee()}</DetailRow>}
      {address && (
        <DetailRow label="Receiving address">
          <img src={walletIcon} alt="Wallet" height={12} width={12} /> {truncate(address)}
        </DetailRow>
      )}
      {route.does_swap && (
        <DetailRow label="Minimum received">
          <img src={dstAsset.logo_uri} alt={dstAsset.symbol} className={styles.token} />{" "}
          {formatAmount(minimumReceived, { decimals: dstAsset.decimals })} {dstAsset.symbol}
        </DetailRow>
      )}
    </TransferTxDetailsBody>
  )
}

/**
 * Deposit API details. The provider is the one choice the user makes here, so
 * it stays visible above the collapsible with the bridge's own duration and
 * opens the picker. Inside the details there is exactly one fee row, labeled as
 * the source network fee: the quoted `amount_out` is already net of the
 * bridge's effects, so a "bridge fee" row would count the same cost twice. The
 * route row names the chains funds pass through; how the Deposit API moves the
 * later hops is its own concern and is not surfaced.
 */
export const DepositTransferTxDetails = ({ model }: { model: DepositTransferModel }) => {
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
  const estimatedTime = estimatedSeconds ? formatDuration(estimatedSeconds) : undefined
  const estimatedTimeStyle =
    estimatedSeconds && estimatedSeconds > LONG_DURATION_SECONDS
      ? { color: "var(--warning)" }
      : undefined
  const providerRow = transport === "lifi" && tool && model.openRouteSelection && (
    <DetailRow label="Provider">
      <button type="button" className={styles.provider} onClick={model.openRouteSelection}>
        <Image src={tool.logoUrl} alt={tool.name} width={14} height={14} logo /> {tool.name}
        <span className={styles.muted} style={estimatedTimeStyle}>
          {" "}
          · {estimatedTime || UNKNOWN}
        </span>
        <IconChevronRight size={12} aria-hidden="true" />
      </button>
    </DetailRow>
  )

  return (
    <TransferTxDetailsBody
      before={providerRow}
      estimatedTime={providerRow ? undefined : estimatedTime || UNKNOWN}
      estimatedTimeStyle={estimatedTimeStyle}
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
          UNKNOWN
        )
      }
    >
      <DetailRow label="Route">
        <span className={styles.route}>
          {model.legs.map((leg, index) => (
            <Fragment key={leg.name}>
              {index > 0 && <IconChevronRight size={10} aria-hidden="true" />}
              <Image src={leg.logoUrl} alt={leg.name} width={14} height={14} logo /> {leg.name}
            </Fragment>
          ))}
        </span>
      </DetailRow>

      <DetailRow label="Network fee">{formatNetworkFee(quote?.estimate.gas_cost_usd)}</DetailRow>

      {/* A bridge's messaging fee travels as the call's native value, in ETH even
          for a USDC deposit. It is not part of the quoted output, so it gets its
          own row; the fee gate blocks when the balance cannot cover it. */}
      {quote && BigInt(quote.transaction.value) > 0n && (
        <DetailRow label="Protocol fee">
          {formatAmount(quote.transaction.value, { decimals: 18 })} {model.nativeSymbol}
        </DetailRow>
      )}

      {/* A host-set recipient is not the connected wallet, so it neither shows
          the wallet icon nor lets the label imply "yours". */}
      <DetailRow label={isHostRecipient ? "Recipient (set by app)" : "Receiving address"}>
        {!isHostRecipient && <img src={walletIcon} alt="Wallet" height={12} width={12} />}{" "}
        {truncate(recipient)}
      </DetailRow>
    </TransferTxDetailsBody>
  )
}

export default TransferTxDetails
