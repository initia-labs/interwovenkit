import { Fragment } from "react"
import { IconCheck, IconChevronRight, IconCopy, IconExternalLink } from "@initia/icons-react"
import { formatAmount, truncate } from "@initia/utils"
import Collapsible from "@/components/Collapsible"
import CopyButton from "@/components/CopyButton"
import DetailRow from "@/components/DetailRow"
import Image from "@/components/Image"
import Skeleton from "@/components/Skeleton"
import { useConfig } from "@/data/config"
import { useConnectedWalletIcon } from "@/hooks/useConnectedWalletIcon"
import { formatDuration } from "@/pages/bridge/data/format"
import onrampStyles from "../onramp/OnrampFields.module.css"
import { getBridgeToolDisplay } from "./depositSources"
import { formatNetworkFee } from "./depositTransferLogic"
import type { DepositTransferModel } from "./useDepositTransfer"
import styles from "./TransferTxDetails.module.css"

// No bridge fee row: the quoted `amount_out` is already net of it.
const DepositTransferTxDetails = ({ model }: { model: DepositTransferModel }) => {
  const { registryUrl } = useConfig()
  const walletIcon = useConnectedWalletIcon()
  const { quote, route, destination, estimatedAmountOut, recipient, isHostRecipient } = model
  const { depositAddress, isEstimating } = model

  if (!model.hasAmount) return null

  const tool = quote ? getBridgeToolDisplay(quote.tool) : undefined

  return (
    <div className={styles.container}>
      <DetailRow label="Route">
        {model.openRouteSelection && !tool && isEstimating ? (
          <Skeleton width={96} height={24} />
        ) : model.openRouteSelection ? (
          <button
            type="button"
            className={onrampStyles.providerPill}
            onClick={model.openRouteSelection}
            disabled={model.isSubmitting || model.approval.isApproving}
          >
            {tool ? (
              <>
                <Image src={tool.logoUrl} width={16} height={16} logo />
                {tool.name}
              </>
            ) : (
              "—"
            )}
            <IconChevronRight size={12} className={onrampStyles.pillChevron} aria-hidden="true" />
          </button>
        ) : (
          model.legs.map((leg, index) => (
            <Fragment key={leg.name}>
              {index > 0 && <IconChevronRight size={10} aria-hidden="true" />}
              <Image src={leg.logoUrl} alt={leg.name} width={14} height={14} logo /> {leg.name}
            </Fragment>
          ))
        )}
      </DetailRow>

      <Collapsible title="Transaction details">
        <DetailRow label="Network fee">{formatNetworkFee(quote?.estimate.gas_cost_usd)}</DetailRow>
        {/* Paid in the native token, outside the quoted output. */}
        {quote && BigInt(quote.transaction.value) > 0n && (
          <DetailRow label="Protocol fee">
            {formatAmount(quote.transaction.value, { decimals: 18 })} ETH
          </DetailRow>
        )}
        <DetailRow label={isHostRecipient ? "Recipient (set by app)" : "Receiving address"}>
          {!isHostRecipient && walletIcon && (
            <img src={walletIcon} alt="Wallet" height={12} width={12} />
          )}{" "}
          {truncate(recipient)}
        </DetailRow>
        {depositAddress && (
          <DetailRow label="Deposit address">
            <CopyButton value={depositAddress}>
              {({ copy, copied }) => (
                <button
                  type="button"
                  className={styles.address}
                  onClick={copy}
                  aria-label={copied ? "Copied" : "Copy deposit address"}
                >
                  {truncate(depositAddress, [8, 6])}
                  {copied ? (
                    <IconCheck size={12} aria-hidden="true" />
                  ) : (
                    <IconCopy size={12} aria-hidden="true" />
                  )}
                </button>
              )}
            </CopyButton>
            <a
              href={`https://etherscan.io/address/${depositAddress}`}
              className={styles.address}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View deposit address on Etherscan"
            >
              <IconExternalLink size={12} aria-hidden="true" />
            </a>
          </DetailRow>
        )}
      </Collapsible>

      <DetailRow label="Estimated time">
        {model.estimatedSeconds ? (
          formatDuration(model.estimatedSeconds)
        ) : isEstimating ? (
          <Skeleton width={48} height={16} />
        ) : (
          "—"
        )}
      </DetailRow>
      <DetailRow label="Estimated received" emphasized>
        {estimatedAmountOut ? (
          <>
            <Image
              src={`${registryUrl}/images/${route.dst_symbol}.png`}
              alt={route.dst_symbol}
              className={styles.token}
              width={14}
              height={14}
            />{" "}
            {formatAmount(estimatedAmountOut, { decimals: destination.decimals })}{" "}
            {route.dst_symbol}
          </>
        ) : isEstimating ? (
          <Skeleton width={96} height={16} />
        ) : (
          "—"
        )}
      </DetailRow>
    </div>
  )
}

export default DepositTransferTxDetails
