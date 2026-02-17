import BigNumber from "bignumber.js"
import { useEffect, useEffectEvent, useMemo, useRef } from "react"
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
  type TransferMode,
  useAllBalancesQuery,
  useExternalAssetOptions,
  useExternalTransferAsset,
  useLocalAssetOptions,
  useLocalTransferAsset,
  useTransferForm,
  useTransferMode,
} from "./hooks"
import TransferFooter from "./TransferFooter"
import styles from "./Fields.module.css"

interface State {
  route?: RouterRouteResponseJson
  recipientAddress?: string
}

interface Props {
  mode: TransferMode
}

const TransferFields = ({ mode }: Props) => {
  const modeConfig = useTransferMode(mode)
  const navigate = useNavigate()
  const state = useLocationState<State>()
  const options = useLocalAssetOptions()
  const findChain = useFindSkipChain()
  const { data: balances } = useAllBalancesQuery()
  const hexAddress = useHexAddress()

  const { watch, setValue, getValues } = useTransferForm()
  const values = watch()
  const { srcChainId, srcDenom, quantity: rawQuantity = "" } = values
  const selectedExternalDenom = values[modeConfig.external.denomKey]
  const selectedExternalChainId = values[modeConfig.external.chainIdKey]

  const localAsset = useLocalTransferAsset(mode)
  const externalAsset = useExternalTransferAsset(mode)
  const { data: externalAssetOptions, isLoading: isExternalAssetOptionsLoading } =
    useExternalAssetOptions(mode)
  const hasSingleExternalAssetOption =
    !isExternalAssetOptionsLoading && externalAssetOptions.length === 1
  const hasSingleWithdrawChainOption = useMemo(() => {
    if (mode !== "withdraw" || isExternalAssetOptionsLoading || !externalAssetOptions.length) {
      return false
    }

    return new Set(externalAssetOptions.map(({ chain }) => chain.chain_id)).size === 1
  }, [externalAssetOptions, isExternalAssetOptionsLoading, mode])
  const autoExternalAssetOption = useMemo(() => {
    if (isExternalAssetOptionsLoading || !externalAssetOptions.length) return null
    if (hasSingleExternalAssetOption) return externalAssetOptions[0]
    if (!hasSingleWithdrawChainOption) return null

    return [...externalAssetOptions].sort(
      ({ balance: a }, { balance: b }) => Number(b?.value_usd ?? 0) - Number(a?.value_usd ?? 0),
    )[0]
  }, [
    externalAssetOptions,
    hasSingleExternalAssetOption,
    hasSingleWithdrawChainOption,
    isExternalAssetOptionsLoading,
  ])
  const autoFillKey = `${mode}:${localAsset?.chain_id ?? ""}:${localAsset?.denom ?? ""}`
  const lastAutoFillKeyRef = useRef<string | null>(null)
  const externalChain = selectedExternalChainId ? findChain(selectedExternalChainId) : null

  const balance = balances?.[srcChainId]?.[srcDenom]?.amount
  const price = balances?.[srcChainId]?.[srcDenom]?.price || 0

  const quantityValue = BigNumber(price || 0).times(rawQuantity || 0)

  const [debouncedQuantity] = useDebounceValue(rawQuantity, 300)

  const amountAsset = mode === "withdraw" ? localAsset : externalAsset

  const disabledMessage = useMemo(() => {
    if (mode === "deposit" && !externalAsset) return "Select asset"

    const quantityBn = BigNumber(rawQuantity || 0)
    if (!quantityBn.isFinite() || quantityBn.lte(0)) return "Enter amount"

    const balanceAmount = fromBaseUnit(balance ?? "0", { decimals: amountAsset?.decimals || 6 })
    if (quantityBn.gt(balanceAmount)) return "Insufficient balance"

    if (mode === "withdraw" && !externalAsset) return "Select destination"
  }, [mode, rawQuantity, balance, amountAsset, externalAsset])

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

  useEffect(() => {
    if (!autoExternalAssetOption) return
    if (selectedExternalDenom && selectedExternalChainId) return
    if (lastAutoFillKeyRef.current === autoFillKey) return

    const { asset, chain } = autoExternalAssetOption

    setValue(modeConfig.external.denomKey, asset.denom)
    setValue(modeConfig.external.chainIdKey, chain.chain_id)
    if (mode === "deposit") setValue("quantity", "")
    lastAutoFillKeyRef.current = autoFillKey
  }, [
    autoFillKey,
    autoExternalAssetOption,
    mode,
    modeConfig.external.chainIdKey,
    modeConfig.external.denomKey,
    selectedExternalChainId,
    selectedExternalDenom,
    setValue,
  ])

  if (!localAsset) return null
  if (mode === "deposit" && !externalAsset) return null

  const amountDecimals = amountAsset?.decimals || 6
  const externalEmptyLabel = mode === "withdraw" ? "Select chain" : "Select asset"

  const resetToPreviousPage = () => {
    setValue("quantity", "")
    setValue(modeConfig.external.denomKey, "")
    setValue(modeConfig.external.chainIdKey, "")

    if (mode === "withdraw" || hasSingleExternalAssetOption) {
      setValue(modeConfig.local.denomKey, "")
      setValue(modeConfig.local.chainIdKey, "")
    }

    // When hasSingleExternalAssetOption, navigating to select-external would
    // immediately auto-fill and jump back to fields, creating an infinite loop.
    // Go directly to select-local instead, which is safe because the Back button
    // only renders when options.length > 1 (so select-local won't auto-skip).
    const previousPage =
      mode === "withdraw" || hasSingleExternalAssetOption ? "select-local" : "select-external"
    setValue("page", previousPage)
  }

  const externalSection = (
    <>
      <p className={styles.label}>{mode === "withdraw" ? "Destination" : "From"}</p>
      <button
        className={styles.asset}
        disabled={hasSingleExternalAssetOption}
        onClick={() => setValue("page", "select-external")}
      >
        <div className={styles.assetIcon}>
          {externalAsset ? (
            <>
              <img src={externalAsset.logo_uri} alt={externalAsset.symbol} />
              <img
                src={externalChain?.logo_uri || ""}
                alt={externalChain?.pretty_name}
                className={styles.chainIcon}
              />
            </>
          ) : (
            mode === "withdraw" && <div className={styles.chainIcon} />
          )}
        </div>
        <p className={styles.assetName}>
          {!externalAsset ? (
            externalEmptyLabel
          ) : (
            <>
              {externalAsset.symbol}
              <br />
              <span>on {externalChain?.pretty_name}</span>
            </>
          )}
        </p>
        {!hasSingleExternalAssetOption && <IconChevronDown className={styles.chevron} size={16} />}
      </button>
    </>
  )

  const amountSection = (
    <>
      <p className={styles.label}>Amount</p>
      <QuantityInput balance={balance} decimals={amountDecimals} className={styles.input} />
      {Number(balance) > 0 && (
        <div className={styles.balanceContainer}>
          <p className={styles.value}>
            {quantityValue.gt(0) ? formatValue(quantityValue.toString()) : "$-"}
          </p>

          <button
            className={styles.maxButton}
            onClick={() => {
              const maxAmount = fromBaseUnit(balance ?? "0", { decimals: amountDecimals })
              if (BigNumber(rawQuantity || 0).eq(maxAmount)) return

              setValue("quantity", maxAmount)
            }}
          >
            <IconWallet size={16} /> {formatAmount(balance, { decimals: amountDecimals })}{" "}
            <span>MAX</span>
          </button>
        </div>
      )}
    </>
  )

  return (
    <div className={styles.container}>
      {options.length > 1 && (
        <button
          type="button"
          aria-label="Back"
          className={styles.back}
          onClick={resetToPreviousPage}
        >
          <IconBack size={20} />
        </button>
      )}
      <h3 className={styles.title}>
        {modeConfig.label} {localAsset.symbol}
      </h3>

      {mode === "withdraw" ? (
        <>
          {amountSection}
          <div className={styles.divider} />
          {externalSection}
        </>
      ) : (
        <>
          {externalSection}
          <div className={styles.divider} />
          {amountSection}
        </>
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
                      {(gas) => <TransferFooter tx={tx} gas={gas} mode={mode} />}
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

export default TransferFields
