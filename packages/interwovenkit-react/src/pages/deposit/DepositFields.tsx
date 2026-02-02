import BigNumber from "bignumber.js"
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

const DepositFields = () => {
  const navigate = useNavigate()
  const state = useLocationState<State>()
  const options = useLocalAssetOptions()
  const findChain = useFindSkipChain()
  const { data: balances } = useAllBalancesQuery()
  const hexAddress = useHexAddress()

  const { watch, setValue, getValues } = useTransferForm()
  const { srcDenom, srcChainId, quantity } = watch()
  const rawQuantity = quantity ?? ""

  const localAsset = useLocalAssetDepositAsset()
  const externalAsset = useExternalDepositAsset()
  const srcChain = srcChainId ? findChain(srcChainId) : null
  const balance = balances?.[srcChainId]?.[srcDenom]?.amount
  const price = balances?.[srcChainId]?.[srcDenom]?.price || 0

  const quantityValue = BigNumber(price || 0).times(rawQuantity || 0)

  const [debouncedQuantity] = useDebounceValue(rawQuantity, 300)

  const disabledMessage = useMemo(() => {
    if (!externalAsset) return "Select asset"
    const quantityBn = new BigNumber(rawQuantity || 0)
    if (!quantityBn.isFinite() || quantityBn.lte(0)) return "Enter amount"
    const balanceAmount = fromBaseUnit(balance ?? "0", {
      decimals: externalAsset?.decimals || 6,
    })
    if (quantityBn.gt(balanceAmount)) return "Insufficient balance"
  }, [rawQuantity, balance, externalAsset])

  const { data: route, error: routeError } = useRouteQuery(debouncedQuantity, {
    disabled: !!disabledMessage,
  })

  const routeForState = !routeError && !disabledMessage ? route : undefined

  const updateNavigationState = useEffectEvent(() => {
    navigate(0, {
      ...state,
      route: routeForState,
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
  }, [routeForState, hexAddress])

  if (!localAsset || !externalAsset) return null

  return (
    <div className={styles.container}>
      {options.length > 1 && (
        <button
          type="button"
          aria-label="Back"
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
      {balance !== undefined && balance !== null && (
        <div className={styles.balanceContainer}>
          <p className={styles.value}>
            {quantityValue.gt(0) ? formatValue(quantityValue.toString()) : "$-"}
          </p>

          <button
            className={styles.maxButton}
            onClick={() => {
              const maxAmount = fromBaseUnit(balance ?? "0", {
                decimals: externalAsset?.decimals || 6,
              })
              if (new BigNumber(rawQuantity || 0).eq(maxAmount)) return

              setValue("quantity", maxAmount)
            }}
          >
            <IconWallet size={16} />{" "}
            {formatAmount(balance, { decimals: externalAsset?.decimals || 6 })} <span>MAX</span>
          </button>
        </div>
      )}
      {!routeForState ? (
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
