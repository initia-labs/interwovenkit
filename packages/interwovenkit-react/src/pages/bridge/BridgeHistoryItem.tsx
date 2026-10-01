import { useEffect } from "react"
import { IconExternalLink } from "@initia/icons-react"
import ExplorerLink from "@/components/ExplorerLink"
import Loader from "@/components/Loader"
import { useSkipAsset } from "./data/assets"
import { useSkipChain } from "./data/chains"
import { useCosmosWallets } from "./data/cosmos"
import { formatFees } from "./data/format"
import type { TxIdentifier } from "./data/history"
import { useBridgeHistoryDetails } from "./data/history"
import { BridgeType, getBridgeType, useTrackTxQuery } from "./data/tx"
import BridgeHistoryCard from "./BridgeHistoryCard"
import BridgeHistoryItemIcon from "./BridgeHistoryItemIcon"

const BridgeHistoryItem = ({ tx }: { tx: TxIdentifier }) => {
  // NOTE: Do not merge history details into one list. Keep them separate.
  // Each transaction needs its own update when its state changes.
  // Managing from a parent causes hooks to re-run on state changes.
  const [details, setDetails] = useBridgeHistoryDetails(tx)
  if (!details) throw new Error("Bridge history details not found")
  const { chainId, txHash, route, values, timestamp, tracked } = details

  const { data: trackedTxHash } = useTrackTxQuery(details)

  const { find } = useCosmosWallets()

  useEffect(() => {
    if (trackedTxHash) {
      setDetails((prev) => {
        if (!prev) throw new Error("Bridge history details not found")
        return { ...prev, tracked: true }
      })
    }
  }, [setDetails, trackedTxHash])

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
  const txChain = useSkipChain(chainId)
  const srcAsset = useSkipAsset(srcDenom, srcChainId)
  const dstAsset = useSkipAsset(dstDenom, dstChainId)

  const type = getBridgeType(route)
  const txChainName = txChain.pretty_name || txChain.chain_name

  const searchParams = new URLSearchParams({ tx_hash: txHash, chain_id: chainId })
  const skipExplorerUrl = new URL(`?${searchParams.toString()}`, "https://explorer.skip.build")

  return (
    <BridgeHistoryCard
      timestamp={timestamp}
      status={!tracked ? <Loader size={14} /> : <BridgeHistoryItemIcon tx={tx} />}
      action={
        type === BridgeType.OP_WITHDRAW ? (
          <ExplorerLink
            chainId={chainId}
            txHash={txHash}
            aria-label={`View transaction on ${txChainName} explorer`}
          >
            {""}
          </ExplorerLink>
        ) : (
          <a
            href={skipExplorerUrl.toString()}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View ${txChainName} transaction on Skip Explorer`}
          />
        )
      }
      explorer={
        <>
          <span>View on {txChainName}</span>
          <IconExternalLink size={12} aria-hidden="true" />
        </>
      }
      source={{
        amount: amount_in,
        decimals: srcAsset.decimals,
        symbol: srcAsset.symbol,
        chainName: srcChain.pretty_name || srcChain.chain_name,
        assetLogoUrl: srcAsset.logo_uri,
        chainLogoUrl: srcChain.logo_uri ?? undefined,
        address: values.sender,
        walletImage: find(values.cosmosWalletName)?.image,
      }}
      destination={{
        amount: amount_out,
        decimals: dstAsset.decimals,
        symbol: dstAsset.symbol,
        chainName: dstChain.pretty_name || dstChain.chain_name,
        assetLogoUrl: dstAsset.logo_uri,
        chainLogoUrl: dstChain.logo_uri ?? undefined,
        address: values.recipient,
      }}
      fees={estimated_fees.length > 0 ? formatFees(estimated_fees) : undefined}
    />
  )
}

export default BridgeHistoryItem
