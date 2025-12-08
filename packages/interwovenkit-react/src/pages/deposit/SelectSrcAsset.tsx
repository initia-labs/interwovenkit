import { IconBack } from "@initia/icons-react"
import { formatAmount } from "@initia/utils"
import { useFindSkipChain } from "../bridge/data/chains"
import { useAllBalancesQuery, useDepositAssets, useDepositForm } from "./hooks"
import styles from "./SelectSrcAsset.module.css"

interface Props {
  onClose: () => void
}

const SelectSrcAsset = ({ onClose }: Props) => {
  const assets = useDepositAssets()
  const findChain = useFindSkipChain()
  const { data: balances } = useAllBalancesQuery()
  const { setValue } = useDepositForm()

  return (
    <div className={styles.container}>
      <button className={styles.close} onClick={onClose}>
        <IconBack size={14} />
      </button>
      <h4 className={styles.title}>Select asset</h4>

      {assets.map((asset) => {
        const chain = findChain(asset.chain_id)
        if (!chain) return null
        // filter out external cosmos chains (different wallet connection is required)
        if (chain.chain_type === "cosmos" && chain.bech32_prefix !== "init") return null

        const balance = balances?.[chain.chain_id][asset.denom]
        if (!balance || !Number(balance.amount)) return null

        return (
          <button
            className={styles.asset}
            onClick={() => {
              setValue("srcDenom", asset.denom)
              setValue("srcChainId", chain.chain_id)
              setValue("quantity", "")
              onClose()
            }}
          >
            <div className={styles.iconContainer}>
              <img src={asset.logo_uri} alt={asset.symbol} className={styles.assetIcon} />
              <img src={chain.logo_uri || ""} alt={chain.chain_name} className={styles.chainIcon} />
            </div>
            <p className={styles.assetName}>{asset.symbol}</p>
            <p className={styles.assetChain}>on {chain.pretty_name}</p>
            <p className={styles.balance}>
              {formatAmount(balance?.amount, { decimals: balance.decimals || 6 })}
            </p>
            <p className={styles.value}>${Number(balance.value_usd).toFixed(2)}</p>
          </button>
        )
      })}
    </div>
  )
}

export default SelectSrcAsset
