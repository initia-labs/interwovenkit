import { useEffect, useMemo } from "react"
import { useDebounceValue } from "usehooks-ts"
import { IconBack, IconChevronDown } from "@initia/icons-react"
import { formatAmount } from "@initia/utils"
import Button from "@/components/Button"
import QuantityInput from "@/components/form/QuantityInput"
import { useLocationState, useNavigate } from "@/lib/router"
import { useHexAddress } from "@/public/data/hooks"
import { useFindSkipChain } from "../bridge/data/chains"
import { type RouterRouteResponseJson, useRouteQuery } from "../bridge/data/simulate"
import FooterWithAddressList from "../bridge/FooterWithAddressList"
import FooterWithMsgs from "../bridge/FooterWithMsgs"
import FooterWithSignedOpHook from "../bridge/FooterWithSignedOpHook"
import WalletIcon from "./assets/WalletIcon"
import DepositFooter from "./DepositFooter"
import FooterWithTxFee from "./FooterWithTxFee"
import {
  useAllBalancesQuery,
  useDepositForm,
  useDepositOptions,
  useDstDepositAsset,
  useFilteredDepositAssets,
  useSrcDepositAsset,
} from "./hooks"
import styles from "./DepositFields.module.css"

interface State {
  route?: RouterRouteResponseJson
}

const DepositFields = () => {
  const navigate = useNavigate()
  const state = useLocationState<State>()
  const options = useDepositOptions()
  const { data: filteredAssets, isLoading: isAssetsLoading } = useFilteredDepositAssets()
  const findChain = useFindSkipChain()
  const { data: balances } = useAllBalancesQuery()
  const hexAddress = useHexAddress()

  const { watch, setValue, getValues } = useDepositForm()
  const { srcDenom, srcChainId, quantity } = watch()

  const dstAsset = useDstDepositAsset()
  const srcAsset = useSrcDepositAsset()
  const srcChain = srcChainId ? findChain(srcChainId) : null
  const balance = balances?.[srcChainId]?.[srcDenom]?.amount
  const price = balances?.[srcChainId]?.[srcDenom]?.price || 0

  const quantityValue = Number(price) * Number(quantity || 0)

  const [debouncedQuantity] = useDebounceValue(quantity, 300)

  const disabledMessage = useMemo(() => {
    if (!srcAsset) return "Select asset"
    if (!quantity) return "Enter amount"
    if (Number(quantity) > Number(formatAmount(balance, { decimals: srcAsset?.decimals || 6 })))
      return "Insufficient balance"

    // Destructure error fields in deps to properly track each field change
  }, [quantity, balance, srcAsset])

  const {
    data: route,
    isLoading: isRouteLoading,
    error: routeError,
  } = useRouteQuery(debouncedQuantity, { disabled: !!disabledMessage })

  useEffect(() => {
    navigate(0, {
      route,
      values: { sender: hexAddress, recipient: hexAddress, slippagePercent: "1", ...getValues() },
    })
  }, [route, getValues, hexAddress, navigate])

  if (!dstAsset || !srcAsset) return null

  return (
    <div className={styles.container}>
      {options.length > 1 && (
        <button
          className={styles.back}
          onClick={() => {
            setValue("dstDenom", "")
            setValue("dstChainId", "")
            // reset other values
            setValue("quantity", "")
            setValue("srcDenom", "")
            setValue("srcChainId", "")
          }}
        >
          <IconBack size={14} />
        </button>
      )}
      <h3 className={styles.title}>Deposit {dstAsset.symbol}</h3>
      <p className={styles.label}>From</p>
      <button
        className={styles.asset}
        onClick={() => {
          if (!isAssetsLoading && !filteredAssets.length) return
          setValue("srcDenom", "")
          setValue("srcChainId", "")
        }}
      >
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
            onClick={() => {
              if (
                Number(quantity) ===
                Number(formatAmount(balance, { decimals: srcAsset?.decimals || 6 }))
              )
                return

              setValue("quantity", formatAmount(balance, { decimals: srcAsset?.decimals || 6 }))
            }}
          >
            <WalletIcon /> {formatAmount(balance, { decimals: srcAsset?.decimals || 6 })}{" "}
            <span>MAX</span>
          </button>
        </div>
      )}
      {!state.route || !!disabledMessage ? (
        <Button.White
          type="submit"
          loading={isRouteLoading}
          disabled={true}
          fullWidth
          className={styles.submit}
        >
          {routeError ? "No route found" : disabledMessage}
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
  )
}

export default DepositFields
