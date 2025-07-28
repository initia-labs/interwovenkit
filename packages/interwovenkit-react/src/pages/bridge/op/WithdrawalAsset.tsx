import type { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin"
import { formatAmount } from "@initia/utils"
import { useLayer1 } from "@/data/chains"
import { useAsset } from "@/data/assets"
import Image from "@/components/Image"
import styles from "./WithdrawalAsset.module.css"

const WithdrawalAsset = ({ amount, denom }: Coin) => {
  const layer1 = useLayer1()
  const asset = useAsset(denom, layer1)
  const { symbol, logoUrl, decimals } = asset

  return (
    <div className={styles.asset}>
      <Image src={logoUrl} width={32} height={32} />
      <div className={styles.info}>
        <span className="monospace">{formatAmount(amount, { decimals })}</span>
        <span className={styles.symbol}>{symbol}</span>
      </div>
    </div>
  )
}

export default WithdrawalAsset
