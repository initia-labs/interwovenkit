import { useDepositForm, useDepositOptions } from "./hooks"
import styles from "./SelectDstAsset.module.css"

const SelectDstAsset = () => {
  const { setValue } = useDepositForm()
  const options = useDepositOptions()

  const selectDst = (denom: string, chain_id: string) => {
    setValue("dstDenom", denom)
    setValue("dstChainId", chain_id)
    // reset other values
    setValue("quantity", "")
    setValue("srcDenom", "")
    setValue("srcChainId", "")

    // navigate to the next page
    setValue("page", "select-src")
  }

  if (options.length === 1) {
    const { denom, chain_id } = options[0]
    selectDst(denom, chain_id)
    return null
  }

  return (
    <>
      <h3 className={styles.title}>Select an asset to receive</h3>
      <div className={styles.list}>
        {options.map(({ denom, chain_id, symbol, logo_uri }) => (
          <button
            className={styles.asset}
            key={`${denom}-${chain_id}`}
            onClick={() => selectDst(denom, chain_id)}
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
