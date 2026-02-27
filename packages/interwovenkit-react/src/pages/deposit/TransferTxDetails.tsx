import clsx from "clsx"
import { useToggle } from "usehooks-ts"
import { IconChevronDown } from "@initia/icons-react"
import { formatAmount, truncate } from "@initia/utils"
import AnimatedHeight from "@/components/AnimatedHeight"
import { useConnectedWalletIcon } from "@/hooks/useConnectedWalletIcon"
import { useLocationState } from "@/lib/router"
import { useInitiaAddress } from "@/public/data/hooks"
import { useAllSkipAssets } from "../bridge/data/assets"
import { calculateMinimumReceived, formatDuration, formatFees } from "../bridge/data/format"
import type { RouterRouteResponseJson } from "../bridge/data/simulate"
import { useBridgePreviewState } from "../bridge/data/tx"
import styles from "./Fields.module.css"

interface Props {
  renderFee?: (() => React.ReactNode) | undefined
}

const TransferTxDetails = ({ renderFee }: Props) => {
  const { route } = useLocationState<{ route?: RouterRouteResponseJson }>()
  const { values } = useBridgePreviewState()
  const { dstDenom, dstChainId } = values
  const skipAssets = useAllSkipAssets()
  const dstAsset = skipAssets.find(
    ({ denom, chain_id }) => denom === dstDenom && chain_id === dstChainId,
  )
  const address = useInitiaAddress()
  const walletIcon = useConnectedWalletIcon()

  const [isDetailsOpen, toggleOpen] = useToggle(false)

  const isLongDuration = route && route.estimated_route_duration_seconds > 60

  if (!route || !dstAsset) return null

  const minimumReceived = calculateMinimumReceived(route.amount_out, values.slippagePercent)

  return (
    <AnimatedHeight>
      <div className={styles.detailsContainer}>
        <button className={styles.detailsButton} onClick={toggleOpen}>
          Transaction details{" "}
          <IconChevronDown
            size={12}
            style={{ transform: isDetailsOpen ? "rotate(180deg)" : "rotate(0deg)" }}
          />
        </button>
        {isDetailsOpen && (
          <>
            {route.does_swap && (
              <div className={styles.detail}>
                <p className={styles.detailLabel}>Slippage</p>
                <p className={styles.detailValue}>{values.slippagePercent}%</p>
              </div>
            )}
            {!!route.estimated_fees?.length && (
              <div className={styles.detail}>
                <p className={styles.detailLabel}>Bridge fee</p>
                <div className={styles.detailValue}>{formatFees(route.estimated_fees)}</div>
              </div>
            )}
            {renderFee && (
              <div className={styles.detail}>
                <p className={styles.detailLabel}>Tx fee</p>
                <div className={styles.detailValue}>{renderFee()}</div>
              </div>
            )}
            {address && (
              <div className={styles.detail}>
                <p className={styles.detailLabel}>Receiving address</p>
                <p className={styles.detailValue}>
                  <img src={walletIcon} alt="Wallet" height={12} width={12} /> {truncate(address)}
                </p>
              </div>
            )}
            {route.does_swap && (
              <div className={styles.detail}>
                <p className={styles.detailLabel}>Minimum received</p>
                <p className={styles.detailValue}>
                  <img src={dstAsset.logo_uri} alt={dstAsset.symbol} className={styles.detailToken} />{" "}
                  {formatAmount(minimumReceived, { decimals: dstAsset.decimals })} {dstAsset.symbol}
                </p>
              </div>
            )}
          </>
        )}
        <div className={styles.detail}>
          <p className={styles.detailLabel}>Estimated time</p>
          <p
            className={clsx(styles.detailValue)}
            style={isLongDuration ? { color: "var(--warning)" } : undefined}
          >
            {formatDuration(route.estimated_route_duration_seconds)}
          </p>
        </div>
        <div className={clsx(styles.detail, styles.receiveSummary)}>
          <p className={styles.detailLabel}>You receive</p>
          <p className={styles.detailValue}>
            <img src={dstAsset.logo_uri} alt={dstAsset.symbol} className={styles.detailToken} />{" "}
            {formatAmount(route.amount_out, { decimals: dstAsset.decimals })} {dstAsset.symbol}
          </p>
        </div>
      </div>
    </AnimatedHeight>
  )
}

export default TransferTxDetails
