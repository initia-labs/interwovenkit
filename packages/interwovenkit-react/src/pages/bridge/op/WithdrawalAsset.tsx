import type { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin"
import FormattedAmount from "@/components/FormattedAmount"
import Image from "@/components/Image"
import { useAsset } from "@/data/assets"
import { useLayer1 } from "@/data/chains"
import styles from "./WithdrawalAsset.module.css"

const WithdrawalAsset = ({ amount, denom }: Coin) => {
  const layer1 = useLayer1()
  const asset = useAsset(denom, layer1)
  const { symbol, logoUrl, decimals } = asset

  return (
    <div className={styles.asset}>
      <Image src={logoUrl} width={32} height={32} logo />
      <div className={styles.info}>
        <FormattedAmount amount={amount} decimals={decimals} className="monospace" />
        <span className={styles.symbol}>{symbol}</span>
      </div>
    </div>
  )
}

export default WithdrawalAsset
