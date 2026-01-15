import { useEffect, useEffectEvent, useMemo } from "react"
import { useDebounceValue } from "usehooks-ts"
import { IconBack, IconChevronDown, IconWallet } from "@initia/icons-react"
import { formatAmount, InitiaAddress } from "@initia/utils"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import QuantityInput from "@/components/form/QuantityInput"
import { formatValue } from "@/lib/format"
import { useLocationState, useNavigate } from "@/lib/router"
import { useHexAddress } from "@/public/data/hooks"
import { useFindSkipChain } from "../bridge/data/chains"
import { type RouterRouteResponseJson, useRouteQuery } from "../bridge/data/simulate"
import FooterWithAddressList from "../bridge/FooterWithAddressList"
import FooterWithMsgs from "../bridge/FooterWithMsgs"
import FooterWithSignedOpHook from "../bridge/FooterWithSignedOpHook"
import FooterWithTxFee from "./FooterWithTxFee"
import {
  useAllBalancesQuery,
  useExternalAssetOptions,
  useExternalDepositAsset,
  useLocalAssetDepositAsset,
  useLocalAssetOptions,
  useTransferForm,
} from "./hooks"
import TransferFooter from "./TransferFooter"
import styles from "./Fields.module.css"

interface State {
  route?: RouterRouteResponseJson
  recipientAddress?: string
}

const DepositFields = () => {
  const navigate = useNavigate()
  const state = useLocationState<State>()
  const options = useLocalAssetOptions()
  const { data: filteredAssets, isLoading: isAssetsLoading } = useExternalAssetOptions()
  const findChain = useFindSkipChain()
  const { data: balances } = useAllBalancesQuery()
  const hexAddress = useHexAddress()

  const { watch, setValue, getValues } = useTransferForm()
  const { srcDenom, srcChainId, quantity } = watch()

  const localAsset = useLocalAssetDepositAsset()
  const externalAsset = useExternalDepositAsset()
  const srcChain = srcChainId ? findChain(srcChainId) : null
  const balance = balances?.[srcChainId]?.[srcDenom]?.amount
  const price = balances?.[srcChainId]?.[srcDenom]?.price || 0

  const quantityValue = Number(price) * Number(quantity || 0)

  const [debouncedQuantity] = useDebounceValue(Number(quantity), 300)

  const disabledMessage = useMemo(() => {
    if (!externalAsset) return "Select asset"
    if (!Number(quantity)) return "Enter amount"
    if (
      Number(quantity) > Number(formatAmount(balance, { decimals: externalAsset?.decimals || 6 }))
    )
      return "Insufficient balance"

    // Destructure error fields in deps to properly track each field change
  }, [quantity, balance, externalAsset])

  const { data: route, error: routeError } = useRouteQuery(debouncedQuantity.toString(), {
    disabled: !!disabledMessage,
  })

  const updateNavigationState = useEffectEvent(() => {
    navigate(0, {
      ...state,
      route,
      values: {
        sender: hexAddress,
        recipient: state.recipientAddress ? InitiaAddress(state.recipientAddress).hex : hexAddress,
        slippagePercent: "1",
        ...getValues(),
      },
    })
  })

  useEffect(() => {
    updateNavigationState()
  }, [route, hexAddress])

  if (!localAsset || !externalAsset) return null

  return (
    <div className={styles.container}>
      {options.length > 1 && (
        <button
          className={styles.back}
          onClick={() => {
            setValue("quantity", "")
            setValue("srcDenom", "")
            setValue("srcChainId", "")
            // navigate to dst page
            setValue("page", "select-external")
          }}
        >
          <IconBack size={20} />
        </button>
      )}
      <h3 className={styles.title}>Deposit {localAsset.symbol}</h3>
      <p className={styles.label}>From</p>
      <button
        className={styles.asset}
        onClick={() => {
          if (!isAssetsLoading && !filteredAssets.length) return
          setValue("page", "select-external")
        }}
      >
        <div className={styles.assetIcon}>
          {!!externalAsset && (
            <>
              <img src={externalAsset?.logo_uri} alt={externalAsset.symbol} />
              <img
                src={srcChain?.logo_uri || ""}
                alt={srcChain?.pretty_name}
                className={styles.chainIcon}
              />
            </>
          )}
        </div>
        <p className={styles.assetName}>
          {!externalAsset ? (
            "Select asset"
          ) : (
            <>
              {externalAsset.symbol}
              <br />
              <span>on {srcChain?.pretty_name}</span>
            </>
          )}
        </p>
        <IconChevronDown className={styles.chevron} size={16} />
      </button>
      <div className={styles.divider} />
      <p className={styles.label}>Amount</p>
      <QuantityInput
        balance={balance}
        decimals={externalAsset?.decimals || 6}
        className={styles.input}
      />
      {balance && (
        <div className={styles.balanceContainer}>
          <p className={styles.value}>{quantityValue ? formatValue(quantityValue) : "$-"}</p>

          <button
            className={styles.maxButton}
            onClick={() => {
              if (
                Number(quantity) ===
                Number(formatAmount(balance, { decimals: externalAsset?.decimals || 6 }))
              )
                return

              setValue(
                "quantity",
                formatAmount(balance, { decimals: externalAsset?.decimals || 6 }),
              )
            }}
          >
            <IconWallet size={16} />{" "}
            {formatAmount(balance, { decimals: externalAsset?.decimals || 6 })} <span>MAX</span>
          </button>
        </div>
      )}
      {!state.route || !!disabledMessage ? (
        <Footer>
          <Button.White
            type="submit"
            loading={!routeError && !disabledMessage && "Fetching route..."}
            disabled={true}
            fullWidth
          >
            {routeError ? "No route found" : disabledMessage}
          </Button.White>
        </Footer>
      ) : (
        <FooterWithAddressList>
          {(addressList) => (
            <FooterWithSignedOpHook>
              {(signedOpHook) => (
                <FooterWithMsgs addressList={addressList} signedOpHook={signedOpHook}>
                  {(tx) => (
                    <FooterWithTxFee tx={tx}>
                      {(gas) => <TransferFooter tx={tx} gas={gas} />}
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
