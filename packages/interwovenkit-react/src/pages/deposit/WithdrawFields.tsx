import { useEffect } from "react"
import { useDebounceValue } from "usehooks-ts"
import { IconBack, IconChevronDown, IconWallet } from "@initia/icons-react"
import { formatAmount, InitiaAddress } from "@initia/utils"
import Button from "@/components/Button"
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

const WithdrawFields = () => {
  const navigate = useNavigate()
  const state = useLocationState<State>()
  const options = useLocalAssetOptions()
  const { data: filteredAssets, isLoading: isAssetsLoading } = useExternalAssetOptions()
  const findChain = useFindSkipChain()
  const { data: balances } = useAllBalancesQuery()
  const hexAddress = useHexAddress()

  const { watch, setValue, getValues } = useTransferForm()
  const { srcChainId, srcDenom, dstChainId, quantity } = watch()

  const localAsset = useLocalAssetDepositAsset()
  const externalAsset = useExternalDepositAsset()

  const balance = balances?.[srcChainId]?.[srcDenom]?.amount
  const price = balances?.[srcChainId]?.[srcDenom]?.price || 0

  const quantityValue = Number(price) * Number(quantity || 0)

  const [debouncedQuantity] = useDebounceValue(quantity, 300)

  let disabledMessage: string | undefined
  if (!localAsset) disabledMessage = "Select asset"
  else if (!Number(quantity)) disabledMessage = "Enter amount"
  else if (
    Number(quantity) > Number(formatAmount(balance, { decimals: localAsset?.decimals || 6 }))
  )
    disabledMessage = "Insufficient balance"

  const {
    data: route,
    isLoading: isRouteLoading,
    error: routeError,
  } = useRouteQuery(debouncedQuantity, { disabled: !!disabledMessage })

  useEffect(() => {
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

    // we don't want to trigger this when state changes, to avoid infinite loop
  }, [route, getValues, hexAddress, navigate]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!localAsset) return null

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
            // navigate to dst page
            setValue("page", "select-local")
          }}
        >
          <IconBack size={14} />
        </button>
      )}
      <h3 className={styles.title}>Withdraw {localAsset.symbol}</h3>
      <p className={styles.label}>Amount</p>
      <QuantityInput
        balance={balance}
        decimals={localAsset?.decimals || 6}
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
                Number(formatAmount(balance, { decimals: localAsset?.decimals || 6 }))
              )
                return

              setValue("quantity", formatAmount(balance, { decimals: localAsset?.decimals || 6 }))
            }}
          >
            <IconWallet size={16} />{" "}
            {formatAmount(balance, { decimals: localAsset?.decimals || 6 })} <span>MAX</span>
          </button>
        </div>
      )}
      <div className={styles.divider} />
      <p className={styles.label}>Destination chain</p>
      <button
        className={styles.asset}
        onClick={() => {
          if (!isAssetsLoading && !filteredAssets.length) return
          setValue("page", "select-external")
        }}
      >
        <div className={styles.assetIcon}>
          {externalAsset ? (
            <>
              <img src={externalAsset?.logo_uri} alt={externalAsset.symbol} />
              <img
                src={findChain(dstChainId)?.logo_uri || ""}
                alt={findChain(dstChainId)?.pretty_name}
                className={styles.chainIcon}
              />
            </>
          ) : (
            <div className={styles.chainIcon} />
          )}
        </div>
        <p className={styles.assetName}>
          {!externalAsset ? (
            "Select chain"
          ) : (
            <>
              {externalAsset.symbol}
              <br />
              <span>on {findChain(dstChainId)?.pretty_name}</span>
            </>
          )}
        </p>
        <IconChevronDown className={styles.chevron} size={16} />
      </button>
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

export default WithdrawFields
