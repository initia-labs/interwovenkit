import { useEffect, useMemo, useState } from "react"
import { useDebounceValue } from "usehooks-ts"
import { IconBack, IconChevronDown, IconWallet } from "@initia/icons-react"
import { formatAmount } from "@initia/utils"
import Button from "@/components/Button"
import QuantityInput from "@/components/form/QuantityInput"
import { useConfig } from "@/data/config"
import { useLocationState, useNavigate } from "@/lib/router"
import { useHexAddress } from "@/public/data/hooks"
import { useAllSkipAssets } from "../bridge/data/assets"
import { useFindSkipChain } from "../bridge/data/chains"
import { type RouterRouteResponseJson, useRouteQuery } from "../bridge/data/simulate"
import FooterWithAddressList from "../bridge/FooterWithAddressList"
import FooterWithMsgs from "../bridge/FooterWithMsgs"
import FooterWithSignedOpHook from "../bridge/FooterWithSignedOpHook"
import DepositFooter from "./DepositFooter"
import FooterWithTxFee from "./FooterWithTxFee"
import { useAllBalancesQuery, useDepositForm } from "./hooks"
import SelectDstAsset from "./SelectDstAsset"
import SelectSrcAsset from "./SelectSrcAsset"
import styles from "./DepositFields.module.css"

interface State {
  route?: RouterRouteResponseJson
}

const DepositFields = () => {
  const navigate = useNavigate()
  const state = useLocationState<State>()
  const { depositOptions = [] } = useConfig()
  const [isSelectorOpen, setSelector] = useState(false)
  const skipAssets = useAllSkipAssets()
  const findChain = useFindSkipChain()
  const { data: balances } = useAllBalancesQuery()
  const hexAddress = useHexAddress()

  const { watch, setValue, formState, getValues } = useDepositForm()
  const { srcDenom, srcChainId, dstDenom, dstChainId, quantity } = watch()
  const { errors } = formState

  const dstAsset =
    skipAssets.find(({ denom, chain_id }) => denom === dstDenom && chain_id === dstChainId) || null
  const srcAsset =
    skipAssets.find(({ denom, chain_id }) => denom === srcDenom && chain_id === srcChainId) || null
  const srcChain = srcChainId ? findChain(srcChainId) : null
  const balance = balances?.[srcChainId]?.[srcDenom]?.amount
  const price = balances?.[srcChainId]?.[srcDenom]?.price || 0

  const quantityValue = Number(price) * Number(quantity || 0)

  const [debouncedQuantity] = useDebounceValue(quantity, 300)
  const {
    data: route,
    isLoading: isRouteLoading,
    error: routeError,
  } = useRouteQuery(debouncedQuantity)

  const disabledMessage = useMemo(() => {
    if (!srcAsset) return "Select asset"
    if (!quantity) return "Enter amount"
    if (errors.quantity) return errors.quantity.message
    if (routeError) return "No route found"

    // Destructure error fields in deps to properly track each field change
  }, [quantity, errors.quantity, srcAsset, routeError])

  useEffect(() => {
    navigate(0, {
      route,
      values: { sender: hexAddress, recipient: hexAddress, slippagePercent: "1", ...getValues() },
    })
  }, [route, getValues, hexAddress, navigate])

  if (!dstAsset) return <SelectDstAsset />
  if (isSelectorOpen) return <SelectSrcAsset onClose={() => setSelector(false)} />

  return (
    <>
      {!!depositOptions.length && (
        <button className={styles.back} onClick={() => navigate(0, { asset: undefined })}>
          <IconBack size={14} />
        </button>
      )}
      <div className={styles.container}>
        <h3 className={styles.title}>Deposit {dstAsset.symbol}</h3>
        <p className={styles.label}>From</p>
        <button className={styles.asset} onClick={() => setSelector(true)}>
          <div className={styles.assetIcon}>
            {!!srcAsset && (
              <>
                <img src={srcAsset?.logo_uri} alt={srcAsset.symbol} />
                <img
                  src={srcChain?.logo_uri || ""}
                  alt={srcChain?.pretty_name}
                  className={styles.chainIcon}
                />
              </>
            )}
          </div>
          <p className={styles.assetName}>
            {!srcAsset ? (
              "Select asset"
            ) : (
              <>
                {srcAsset.symbol}
                <br />
                <span>on {srcChain?.pretty_name}</span>
              </>
            )}
          </p>
          <IconChevronDown className={styles.chevron} size={16} />
        </button>
        <p className={styles.label}>Amount</p>
        <QuantityInput
          balance={balance}
          decimals={srcAsset?.decimals || 6}
          className={styles.input}
        />
        {balance && (
          <div className={styles.balanceContainer}>
            <p className={styles.value}>${quantityValue ? quantityValue.toFixed(2) : "-"}</p>

            <button
              className={styles.maxButton}
              onClick={() =>
                setValue("quantity", formatAmount(balance, { decimals: srcAsset?.decimals || 6 }))
              }
            >
              <IconWallet /> {formatAmount(balance, { decimals: srcAsset?.decimals || 6 })}{" "}
              <span>MAX</span>
            </button>
          </div>
        )}

        {!state.route ? (
          <Button.White
            type="submit"
            loading={isRouteLoading || !disabledMessage}
            disabled={true}
            fullWidth
            className={styles.submit}
          >
            {disabledMessage}
          </Button.White>
        ) : (
          <FooterWithAddressList>
            {(addressList) => (
              <FooterWithSignedOpHook>
                {(signedOpHook) => (
                  <FooterWithMsgs addressList={addressList} signedOpHook={signedOpHook}>
                    {(tx) => (
                      <FooterWithTxFee tx={tx}>
                        {(gas) => <DepositFooter tx={tx} gas={gas} />}
                      </FooterWithTxFee>
                    )}
                  </FooterWithMsgs>
                )}
              </FooterWithSignedOpHook>
            )}
          </FooterWithAddressList>
        )}
      </div>
    </>
  )
}

export default DepositFields
