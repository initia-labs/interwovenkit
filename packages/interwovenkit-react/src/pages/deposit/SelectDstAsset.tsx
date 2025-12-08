import { useConfig } from "@/data/config"
import { useAllSkipAssets } from "../bridge/data/assets"
import { useDepositForm } from "./hooks"
import styles from "./SelectDstAsset.module.css"

const SelectDstAsset = () => {
  const { depositOptions = [] } = useConfig()
  const skipAssets = useAllSkipAssets()
  const options = skipAssets.filter(({ denom, chain_id }) =>
    depositOptions.some((opt) => opt.denom === denom && opt.chainId === chain_id),
  )
  const { setValue } = useDepositForm()

  return (
    <>
      <h3 className={styles.title}>Select an asset to receive</h3>
      <div className={styles.list}>
        {options.map(({ denom, chain_id, symbol, logo_uri }) => (
          <button
            className={styles.asset}
            key={`${denom}-${chain_id}`}
            onClick={() => {
              setValue("dstDenom", denom)
              setValue("dstChainId", chain_id)
              // reset other values
              setValue("quantity", "")
              setValue("srcDenom", "")
              setValue("srcChainId", "")
            }}
          >
            <img src={logo_uri} alt={symbol} />
            {symbol}
          </button>
        ))}
      </div>
    </>
  )
}

export default SelectDstAsset
