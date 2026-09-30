import { format } from "date-fns"
import { IconArrowDown } from "@initia/icons-react"
import { formatAmount } from "@initia/utils"
import Images from "@/components/Images"
import BridgeHistoryAccount from "./BridgeHistoryAccount"
import styles from "./BridgeHistoryItem.module.css"

import type { ReactNode } from "react"

interface HistoryAsset {
  amount?: string
  decimals: number
  symbol: string
  chainName: string
  assetLogoUrl?: string
  chainLogoUrl?: string
  address: string
  walletImage?: string
}

interface Props {
  timestamp: number
  status: ReactNode
  action: ReactNode
  explorer: ReactNode
  source: HistoryAsset
  destination: HistoryAsset
  fees?: string
}

const AssetRow = ({ asset }: { asset: HistoryAsset }) => (
  <div className={styles.row}>
    <Images assetLogoUrl={asset.assetLogoUrl} chainLogoUrl={asset.chainLogoUrl} />
    <div>
      <div className={styles.asset}>
        <span className={styles.amount}>
          {asset.amount ? formatAmount(asset.amount, { decimals: asset.decimals }) : "—"}
        </span>
        <span>{asset.symbol}</span>
      </div>
      <div className={styles.chain}>
        <span>on {asset.chainName}</span>
        <BridgeHistoryAccount address={asset.address} image={asset.walletImage} />
      </div>
    </div>
  </div>
)

const BridgeHistoryCard = ({
  timestamp,
  status,
  action,
  explorer,
  source,
  destination,
  fees,
}: Props) => (
  <div className={styles.link}>
    <div className={styles.action}>{action}</div>
    <header className={styles.header}>
      <div className={styles.title}>
        {status}
        <span className={styles.date}>{format(new Date(timestamp), "h:mm a")}</span>
      </div>
      <div className={styles.explorer}>{explorer}</div>
    </header>
    <div className={styles.route}>
      <AssetRow asset={source} />
      <div className={styles.arrow}>
        <IconArrowDown size={12} aria-hidden="true" />
      </div>
      <AssetRow asset={destination} />
    </div>
    {fees && (
      <div className={styles.fees}>
        <span className={styles.label}>Fees</span>
        <span className={styles.content}>{fees}</span>
      </div>
    )}
  </div>
)

export default BridgeHistoryCard
