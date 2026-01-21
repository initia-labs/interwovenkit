import { useEffect, useEffectEvent, useMemo } from "react"
import { useDebounceValue } from "usehooks-ts"
import { IconBack, IconChevronDown, IconWallet } from "@initia/icons-react"
import { formatAmount, fromBaseUnit, InitiaAddress } from "@initia/utils"
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

  const [debouncedQuantity] = useDebounceValue(Number(quantity), 300)

  const disabledMessage = useMemo(() => {
    if (!Number(quantity)) return "Enter amount"
    if (Number(quantity) > Number(fromBaseUnit(balance, { decimals: localAsset?.decimals || 6 })))
      return "Insufficient balance"
    if (!externalAsset) return "Select destination"
    // Forced to use eslint-disable due to an issue with react-hooks/exhaustive-deps
    // which for some reason thinks quantity is not a stable dependency even tho it works fine in DepositFields
    // eslint-disable-next-line react-hooks/preserve-manual-memoization
  }, [quantity, balance, externalAsset, localAsset])
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
          <IconBack size={20} />
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
              const maxAmount = fromBaseUnit(balance, { decimals: localAsset?.decimals || 6 })
              if (Number(quantity) === Number(maxAmount)) return

              setValue("quantity", maxAmount)
            }}
          >
            <IconWallet size={16} />{" "}
            {formatAmount(balance, { decimals: localAsset?.decimals || 6 })} <span>MAX</span>
          </button>
        </div>
      )}
      <div className={styles.divider} />
      <p className={styles.label}>Destination</p>
      <button
        className={styles.asset}
        onClick={() => {
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
        <Footer>
          <Button.White
            type="submit"
            loading={!routeError && !disabledMessage && "Fetching route..."}
            disabled={true}
            fullWidth
            className={styles.submit}
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

export default WithdrawFields
