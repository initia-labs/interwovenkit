import { formatAmount, truncate } from "@initia/utils"
import Collapsible from "@/components/Collapsible"
import DetailRow from "@/components/DetailRow"
import { useConnectedWalletIcon } from "@/hooks/useConnectedWalletIcon"
import { useLocationState } from "@/lib/router"
import { useAllSkipAssets } from "@/pages/bridge/data/assets"
import { calculateMinimumReceived, formatDuration, formatFees } from "@/pages/bridge/data/format"
import type { RouterRouteResponseJson } from "@/pages/bridge/data/simulate"
import { useBridgePreviewState } from "@/pages/bridge/data/tx"
import { useInitiaAddress } from "@/public/data/hooks"
import { normalizeDenom } from "../data/assetOptions"
import styles from "./TransferTxDetails.module.css"

import type { CSSProperties, ReactNode } from "react"

interface BodyProps {
  children: ReactNode
  /** Rows that stay visible above the collapsible (the provider choice). */
  before?: ReactNode
  /** Omitted when another row (the provider) already carries the total. */
  estimatedTime?: ReactNode
  estimatedTimeStyle?: CSSProperties
  estimatedReceived: ReactNode
}

// Shared by the Router preview and the Deposit API controller: the estimate rows
// stay outside the collapsible so both paths keep them always visible.
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

export default TransferTxDetails
