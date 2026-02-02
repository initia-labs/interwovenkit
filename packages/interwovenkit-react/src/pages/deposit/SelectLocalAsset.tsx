import { useEffect, useEffectEvent } from "react"
import { usePath } from "@/lib/router"
import { useLocalAssetOptions, useTransferForm } from "./hooks"
import styles from "./SelectLocalAsset.module.css"

const SelectLocalAsset = () => {
  const path = usePath()
  const { setValue } = useTransferForm()
  const options = useLocalAssetOptions()
  const isWithdraw = path === "/withdraw"

  const localDenomKey = isWithdraw ? "srcDenom" : "dstDenom"
  const localChainIdKey = isWithdraw ? "srcChainId" : "dstChainId"
  const externalDenomKey = isWithdraw ? "dstDenom" : "srcDenom"
  const externalChainIdKey = isWithdraw ? "dstChainId" : "srcChainId"

  const selectLocalAsset = (denom: string, chain_id: string) => {
    setValue(localDenomKey, denom)
    setValue(localChainIdKey, chain_id)
    // reset other values
    setValue("quantity", "")
    setValue(externalDenomKey, "")
    setValue(externalChainIdKey, "")

    // navigate to the next page
    setValue("page", isWithdraw ? "fields" : "select-external")
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

  if (options.length === 0) {
    return <div>No assets found</div>
  }

  return (
    <>
      <h3 className={styles.title}>
        {isWithdraw ? "Select an asset to withdraw" : "Select an asset to receive"}
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
