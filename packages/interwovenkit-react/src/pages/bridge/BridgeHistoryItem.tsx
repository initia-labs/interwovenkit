import { useAccount } from "wagmi"
import { intlFormatDistance } from "date-fns"
import { useEffect, useMemo, type ReactNode } from "react"
import type { StatusResponseJson } from "@skip-go/client"
import {
  IconArrowDown,
  IconCheckCircleFilled,
  IconExternalLink,
  IconWallet,
  IconWarningFilled,
} from "@initia/icons-react"
import { AddressUtils, formatAmount, truncate } from "@/public/utils"
import Loader from "@/components/Loader"
import Image from "@/components/Image"
import Images from "@/components/Images"
import ExplorerLink from "@/components/ExplorerLink"
import { formatFees } from "./data/format"
import type { RouterChainJson } from "./data/chains"
import { useSkipChain } from "./data/chains"
import type { RouterAsset } from "./data/assets"
import { useSkipAsset } from "./data/assets"
import { BridgeType, getBridgeType, useTrackTxQuery, useTxStatusQuery } from "./data/tx"
import type { TxIdentifier } from "./data/history"
import { useBridgeHistoryDetails } from "./data/history"
import { useCosmosWallets } from "./data/cosmos"
import styles from "./BridgeHistoryItem.module.css"

const BridgeHistoryItem = ({ tx }: { tx: TxIdentifier }) => {
  // NOTE: Do not merge history details into one list. Keep them separate.
  // Each transaction needs its own update when its state changes.
  // Managing from a parent causes hooks to re-run on state changes.
  const [details, setDetails] = useBridgeHistoryDetails(tx)
  if (!details) throw new Error("Bridge history details not found")
  const { chainId, txHash, route, values, timestamp } = details

  const { data: trackedTxHash = "" } = useTrackTxQuery(details, details.tracked)
  const { data: txStatus } = useTxStatusQuery(details, !details.tracked || !!details.state)
  const state = details.state ?? getState(txStatus)

  const { address: connectedAddress = "", connector } = useAccount()
  const { find } = useCosmosWallets()

  useEffect(() => {
    if (trackedTxHash) {
      setDetails((prev) => {
        if (!prev) throw new Error("Bridge history details not found")
        return { ...prev, tracked: true }
      })
    }
  }, [setDetails, trackedTxHash])

  useEffect(() => {
    if (state !== "loading") {
      setDetails((prev) => {
        if (!prev) throw new Error("Bridge history details not found")
        return { ...prev, tracked: true, state }
      })
    }
  }, [setDetails, state, txHash])

  const renderIcon = () => {
    switch (state) {
      case "error":
        return (
          <div className={styles.error}>
            <IconWarningFilled size={14} />
          </div>
        )

      case "success":
        return (
          <div className={styles.success}>
            <IconCheckCircleFilled size={14} />
          </div>
        )

      default:
        return <Loader size={14} />
    }
  }

  const {
    amount_in,
    amount_out,
    source_asset_chain_id: srcChainId,
    source_asset_denom: srcDenom,
    dest_asset_chain_id: dstChainId,
    dest_asset_denom: dstDenom,
    estimated_fees = [],
  } = route

  const srcChain = useSkipChain(srcChainId)
  const dstChain = useSkipChain(dstChainId)
  const srcAsset = useSkipAsset(srcDenom, srcChainId)
  const dstAsset = useSkipAsset(dstDenom, dstChainId)

  const getWalletIcon = (address: string, image?: string) => {
    if (image) {
      return <Image src={image} width={12} height={12} />
    }

    if (AddressUtils.equals(address, connectedAddress)) {
      return <Image src={connector?.icon} width={12} height={12} />
    }

    return <IconWallet size={12} />
  }

  const renderRow = (
    amount: string,
    { symbol, decimals, logo_uri }: RouterAsset,
    { chain_name, pretty_name, ...chain }: RouterChainJson,
    address: string,
    walletIcon: ReactNode,
  ) => {
    return (
      <div className={styles.row}>
        <Images assetLogoUrl={logo_uri} chainLogoUrl={chain.logo_uri ?? undefined} />
        <div>
          <div className={styles.asset}>
            <span className={styles.amount}>{formatAmount(amount, { decimals })}</span>
            <span>{symbol}</span>
          </div>
          <div className={styles.chain}>
            <span>on {pretty_name || chain_name}</span>
            <div className={styles.account}>
              {walletIcon}
              <span className="monospace">{truncate(address)}</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const type = getBridgeType(route)
  const linkLabel = useMemo(() => {
    switch (type) {
      case BridgeType.SKIP:
        return "Skip Explorer"
      case BridgeType.OP_WITHDRAW:
        return "Initia Scan"
    }
  }, [type])

  const content = (
    <>
      <header className={styles.header}>
        <div className={styles.title}>
          {renderIcon()}
          <div className={styles.date}>
            {intlFormatDistance(new Date(timestamp), new Date(), { locale: "en-US" })}
          </div>
        </div>
        <div className={styles.explorer}>
          <span>{linkLabel}</span>
          <IconExternalLink size={12} />
        </div>
      </header>

      <div className={styles.route}>
        {renderRow(
          amount_in,
          srcAsset,
          srcChain,
          values.sender,
          getWalletIcon(values.sender, find(values.cosmosWalletName)?.image),
        )}

        <div className={styles.arrow}>
          <IconArrowDown size={12} />
        </div>

        {renderRow(
          amount_out,
          dstAsset,
          dstChain,
          values.recipient,
          getWalletIcon(values.recipient),
        )}
      </div>

      {estimated_fees.length > 0 && (
        <div className={styles.fees}>
          <span className={styles.label}>Fees</span>
          <span className={styles.content}>{formatFees(estimated_fees)}</span>
        </div>
      )}
    </>
  )

  if (type === BridgeType.OP_WITHDRAW) {
    return (
      <ExplorerLink chainId={chainId} txHash={txHash} className={styles.link}>
        {content}
      </ExplorerLink>
    )
  }

  const searchParams = new URLSearchParams({ tx_hash: txHash, chain_id: chainId })
  const skipExplorerUrl = new URL(`?${searchParams.toString()}`, "https://explorer.skip.build")

  return (
    <a href={skipExplorerUrl.toString()} className={styles.link} target="_blank">
      {content}
    </a>
  )
}

export default BridgeHistoryItem

function getState(data?: StatusResponseJson | null) {
  if (!data) return "loading"

  switch (data.state) {
    case "STATE_ABANDONED":
    case "STATE_COMPLETED_ERROR":
    case "STATE_PENDING_ERROR":
      return "error"

    case "STATE_COMPLETED_SUCCESS":
      return "success"

    default:
      return "loading"
  }
}
