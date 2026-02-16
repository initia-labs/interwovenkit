import { useEffect, useEffectEvent } from "react"
import { type TransferMode, useLocalAssetOptions, useTransferForm, useTransferMode } from "./hooks"
import styles from "./SelectLocalAsset.module.css"

interface Props {
  mode: TransferMode
}

const SelectLocalAsset = ({ mode }: Props) => {
  const { local, external } = useTransferMode(mode)
  const { setValue } = useTransferForm()
  const options = useLocalAssetOptions()

  const selectLocalAsset = (denom: string, chain_id: string) => {
    setValue(local.denomKey, denom)
    setValue(local.chainIdKey, chain_id)
    // reset other values
    setValue("quantity", "")
    setValue(external.denomKey, "")
    setValue(external.chainIdKey, "")

    // navigate to the next page
    setValue("page", mode === "withdraw" ? "fields" : "select-external")
  }

  const selectDefaultAsset = useEffectEvent(() => {
    const { denom, chain_id } = options[0]
    selectLocalAsset(denom, chain_id)
  })

  useEffect(() => {
    if (options.length === 1) {
      selectDefaultAsset()
    }
  }, [options])

  if (!options.length) {
    return <div>No assets found</div>
  }

  return (
    <>
      <h3 className={styles.title}>
        {mode === "withdraw" ? "Select an asset to withdraw" : "Select an asset to receive"}
      </h3>
      <div className={styles.list}>
        {options.map(({ denom, chain_id, symbol, logo_uri }) => (
          <button
            className={styles.asset}
            key={`${denom}-${chain_id}`}
            onClick={() => selectLocalAsset(denom, chain_id)}
          >
            <img src={logo_uri} alt={symbol} />
            {symbol}
          </button>
        ))}
      </div>
    </>
  )
}

export default SelectLocalAsset
