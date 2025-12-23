import clsx from "clsx"
import { useToggle } from "usehooks-ts"
import { IconChevronDown } from "@initia/icons-react"
import { formatAmount, truncate } from "@initia/utils"
import { useConnectedWalletIcon } from "@/hooks/useConnectedWalletIcon"
import { useLocationState } from "@/lib/router"
import { useInitiaAddress } from "@/public/data/hooks"
import { useAllSkipAssets } from "../bridge/data/assets"
import { formatDuration } from "../bridge/data/format"
import type { RouterRouteResponseJson } from "../bridge/data/simulate"
import { useBridgePreviewState } from "../bridge/data/tx"
import styles from "./DepositFields.module.css"

interface Props {
  renderFee?: (() => React.ReactNode) | undefined
}

const DepositTxDetails = ({ renderFee }: Props) => {
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

  const minimumReceived = route.does_swap
    ? (BigInt(route.estimated_amount_out) * BigInt(10000 - Number(values.slippagePercent) * 100)) /
      BigInt(10000)
    : BigInt(route.estimated_amount_out)

  return (
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
          {renderFee && (
            <div className={styles.detail}>
              <p className={styles.detailLabel}>Tx fee</p>
              <p className={styles.detailValue}>{renderFee()}</p>
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
      <div className={clsx(styles.detail, styles.minimumReceived)}>
        <p className={styles.detailLabel}>Minimum received</p>
        <p className={styles.detailValue}>
          <img src={dstAsset.logo_uri} alt={dstAsset.symbol} className={styles.detailToken} />{" "}
          {formatAmount(minimumReceived, { decimals: dstAsset.decimals })} {dstAsset.symbol}
        </p>
      </div>
    </div>
  )
}

export default DepositTxDetails
