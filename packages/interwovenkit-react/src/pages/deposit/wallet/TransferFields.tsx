import BigNumber from "bignumber.js"
import { HTTPError } from "ky"
import { useEffect, useEffectEvent, useLayoutEffect, useMemo } from "react"
import { useDebounceValue } from "usehooks-ts"
import { IconChevronDown, IconWallet } from "@initia/icons-react"
import { formatAmount, fromBaseUnit } from "@initia/utils"
import AsyncBoundary from "@/components/AsyncBoundary"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import QuantityInput from "@/components/form/QuantityInput"
import { parseQuantity } from "@/lib/amountValidation"
import { formatValueWithPrice } from "@/lib/format"
import { useLocationState, useNavigate } from "@/lib/router"
import { useFindSkipChain } from "@/pages/bridge/data/chains"
import { useRouteQuery } from "@/pages/bridge/data/simulate"
import FooterWithAddressList from "@/pages/bridge/FooterWithAddressList"
import FooterWithMsgs from "@/pages/bridge/FooterWithMsgs"
import FooterWithSignedOpHook from "@/pages/bridge/FooterWithSignedOpHook"
import { useHexAddress } from "@/public/data/hooks"
import { useLocalAssetOptions } from "../data/assetOptions"
import DepositBackButton from "../DepositBackButton"
import DepositStatus from "../DepositStatus"
import { findBalanceByDenom, useAllBalancesQuery } from "./balances"
import {
  useExternalAssetOptions,
  useExternalTransferAsset,
  useLocalTransferAsset,
} from "./externalAssets"
import FooterWithTxFee from "./FooterWithTxFee"
import { getResolvedTransferBalance, getTransferBalanceBlocker } from "./transferBalanceGate"
import { useTransferFlow, useTransferForm, useTransferMode } from "./transferFlowConfig"
import TransferFooter from "./TransferFooter"
import {
  buildTransferLocationState,
  getTransferBackNavigation,
  shouldSyncTransferNavigationState,
  type TransferLocationState,
} from "./transferNavigation"
import styles from "./TransferFields.module.css"

type RouteStatus = "disabled" | "loading" | "ready" | "no-route" | "server-error" | "refresh-failed"

function getRouteStatus({
  disabledMessage,
  routeForState,
  routeError,
  isNoRouteError,
  isServerError,
}: {
  disabledMessage?: string
  routeForState?: unknown
  routeError: Error | null
  isNoRouteError: boolean
  isServerError: boolean
}): RouteStatus {
  if (disabledMessage) return "disabled"
  if (routeForState) return "ready"
  if (!routeError) return "loading"
  if (isNoRouteError) return "no-route"
  if (isServerError) return "server-error"
  return "refresh-failed"
}

function shouldRenderPreviewFooter({
  hasRouteState,
  routeStatus,
}: {
  hasRouteState: boolean
  routeStatus: RouteStatus
}): boolean {
  return hasRouteState && (routeStatus === "ready" || routeStatus === "loading")
}

function getRouteStatusText({
  routeStatus,
  disabledMessage,
  isRouteSynced,
}: {
  routeStatus: RouteStatus
  disabledMessage?: string
  isRouteSynced: boolean
}): string | undefined {
  if (routeStatus === "disabled") return disabledMessage
  if (routeStatus === "loading") return "Fetching route..."
  if (routeStatus === "ready" && !isRouteSynced) return "Fetching route..."
  if (routeStatus === "no-route") return "No route found"
  if (routeStatus === "server-error") return "Server error"
  if (routeStatus === "refresh-failed") return "Failed to refresh route"
}

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect

const TransferFields = () => {
  const { mode, onExit } = useTransferFlow()
  const modeConfig = useTransferMode()
  const navigate = useNavigate()
  const state = useLocationState<TransferLocationState>()
  const { data: options } = useLocalAssetOptions()
  const findChain = useFindSkipChain()
  const {
    data: balances,
    error: balancesError,
    chainsError,
    isLoading: isBalancesLoading,
  } = useAllBalancesQuery()
  const hexAddress = useHexAddress()

  const { watch, setValue, getValues } = useTransferForm()
  const values = watch()
  const { srcChainId, srcDenom, quantity: rawQuantity = "" } = values
  const { recipientAddress, route: currentRoute } = state
  const selectedExternalDenom = values[modeConfig.external.denomKey]
  const selectedExternalChainId = values[modeConfig.external.chainIdKey]

  const localAsset = useLocalTransferAsset()
  const externalAsset = useExternalTransferAsset()
  const { data: externalAssetOptions, isLoading: isExternalAssetOptionsLoading } =
    useExternalAssetOptions()
  const hasSingleExternalAssetOption =
    !isExternalAssetOptionsLoading && externalAssetOptions.length === 1
  const hasSingleWithdrawChainOption =
    mode === "withdraw" &&
    !isExternalAssetOptionsLoading &&
    externalAssetOptions.length > 0 &&
    new Set(externalAssetOptions.map(({ chain }) => chain.chain_id)).size === 1
  const autoExternalAssetOption = useMemo(() => {
    if (isExternalAssetOptionsLoading || !externalAssetOptions.length) return null
    if (hasSingleExternalAssetOption) return externalAssetOptions[0]
    if (!hasSingleWithdrawChainOption) return null

    return externalAssetOptions.reduce((highest, option) => {
      const highestUsd = Number(highest.balance?.value_usd ?? 0)
      const optionUsd = Number(option.balance?.value_usd ?? 0)

      return optionUsd > highestUsd ? option : highest
    }, externalAssetOptions[0])
  }, [
    externalAssetOptions,
    hasSingleExternalAssetOption,
    hasSingleWithdrawChainOption,
    isExternalAssetOptionsLoading,
  ])
  const autoExternalAssetOptionKey = autoExternalAssetOption
    ? `${autoExternalAssetOption.chain.chain_id}:${autoExternalAssetOption.asset.denom}`
    : ""
  const externalChain = selectedExternalChainId ? findChain(selectedExternalChainId) : null

  // `srcDenom` may carry the host-provided casing (withdraw's local denom),
  // while the balances map is keyed by Skip's casing — a raw key lookup would
  // resolve to zero and permanently gate the form on "Insufficient balance".
  const sourceBalanceEntry = findBalanceByDenom(balances?.[srcChainId], srcDenom)
  const sourceBalance = sourceBalanceEntry?.amount
  const price = sourceBalanceEntry?.price

  // `price` is Skip's `string | null` — `|| 0` (not `?? 0`) catches both empty strings and null.
  // `parseQuantity` returns `BigNumber | null`, so `?? 0` is the documented choice for that branch.
  const quantityValue = BigNumber(price || 0).times(parseQuantity(rawQuantity) ?? 0)

  const [debouncedQuantity] = useDebounceValue(rawQuantity, 300)

  const amountAsset = mode === "withdraw" ? localAsset : externalAsset
  const balanceBlocker = getTransferBalanceBlocker({
    hasBalancesSnapshot: balances !== undefined,
    hasBalanceQueryError: !!(balancesError || chainsError),
    isBalancesLoading,
  })
  // Once balances have loaded, a missing denom means zero balance.
  // Keep `undefined` only while the first snapshot is still loading.
  const balance = getResolvedTransferBalance({
    hasBalancesSnapshot: balances !== undefined,
    balance: sourceBalance,
  })

  const disabledMessage = useMemo(() => {
    if (mode === "deposit" && !externalAsset) return "Select asset"

    const quantityBn = parseQuantity(rawQuantity)
    if (!quantityBn || quantityBn.lte(0)) return "Enter amount"

    if (mode === "withdraw" && !externalAsset) return "Select destination"

    if (balanceBlocker === "loading") return "Loading balances..."
    if (balanceBlocker === "error") return "Failed to load balances"

    if (balance !== undefined) {
      const balanceAmount = fromBaseUnit(balance, { decimals: amountAsset?.decimals || 6 })
      if (quantityBn.gt(balanceAmount || 0)) return "Insufficient balance"
    }
  }, [amountAsset, balance, balanceBlocker, externalAsset, mode, rawQuantity])
  const isRouteQueryDisabled = useMemo(() => {
    if (mode === "deposit" && !externalAsset) return true

    const quantityBn = parseQuantity(rawQuantity)
    if (!quantityBn || quantityBn.lte(0)) return true

    if (mode === "withdraw" && !externalAsset) return true
    if (balanceBlocker === "error") return true

    if (balance !== undefined) {
      const balanceAmount = fromBaseUnit(balance, { decimals: amountAsset?.decimals || 6 })
      if (quantityBn.gt(balanceAmount || 0)) return true
    }

    return false
  }, [amountAsset, balance, balanceBlocker, externalAsset, mode, rawQuantity])

  const {
    data: route,
    error: routeError,
    dataUpdatedAt: routeUpdatedAt,
  } = useRouteQuery(debouncedQuantity, {
    disabled: isRouteQueryDisabled,
  })

  // Keep the latest successful route while background refetches run.
  // React Query may expose both `data` and `error` when a refetch fails.
  const isNoRouteError = routeError instanceof HTTPError && routeError.response.status === 400
  const routeForState = !disabledMessage && !isNoRouteError ? route : undefined
  const quoteVerifiedAt = routeForState && routeUpdatedAt > 0 ? routeUpdatedAt : undefined
  const isServerError = routeError instanceof HTTPError && routeError.response.status === 500
  const routeStatus = getRouteStatus({
    disabledMessage,
    routeForState,
    routeError,
    isNoRouteError,
    isServerError,
  })
  const isRouteSynced = routeStatus === "ready" && state.route === routeForState
  const isRouteTransitioning =
    routeStatus === "loading" || (routeStatus === "ready" && !isRouteSynced)
  const canRenderPreviewFooter = shouldRenderPreviewFooter({
    hasRouteState: !!state.route,
    routeStatus,
  })
  const routeStatusText = getRouteStatusText({ routeStatus, disabledMessage, isRouteSynced })

  // Sync before paint to prevent flash of the simple footer.
  // Depend on the specific primitives that can change the derived location state
  // without depending on the full `state` object, which would loop after navigate().
  useIsomorphicLayoutEffect(() => {
    const nextState = buildTransferLocationState({
      currentState: state,
      route: routeForState,
      quoteVerifiedAt,
      hexAddress,
      values: getValues(),
    })

    if (!shouldSyncTransferNavigationState({ currentState: state, nextState })) return

    navigate(0, nextState)
  }, [
    currentRoute,
    getValues,
    hexAddress,
    navigate,
    quoteVerifiedAt,
    recipientAddress,
    routeForState,
  ])

  const applyAutoExternalOption = useEffectEvent(() => {
    if (!autoExternalAssetOption) return
    if (selectedExternalDenom && selectedExternalChainId) return

    const { asset, chain } = autoExternalAssetOption

    setValue(modeConfig.external.denomKey, asset.denom)
    setValue(modeConfig.external.chainIdKey, chain.chain_id)
    if (mode === "deposit") setValue("quantity", "")
  })

  useEffect(() => {
    applyAutoExternalOption()
  }, [autoExternalAssetOptionKey])

  if (!localAsset) return null
  if (mode === "deposit" && !externalAsset) return null

  const amountDecimals = amountAsset?.decimals || 6
  const externalEmptyLabel = mode === "withdraw" ? "Select chain" : "Select asset"

  const resetToPreviousPage = () => {
    // The destination logic (including the single-external-option infinite-loop
    // guard) lives in getTransferBackNavigation.
    const backNavigation = getTransferBackNavigation({
      mode,
      hasSingleExternalAssetOption,
      canExit: !!onExit,
    })

    if (backNavigation.type === "exit") {
      onExit?.()
      return
    }

    setValue("quantity", "")
    setValue(modeConfig.external.denomKey, "")
    setValue(modeConfig.external.chainIdKey, "")

    if (backNavigation.clearLocal) {
      setValue(modeConfig.local.denomKey, "")
      setValue(modeConfig.local.chainIdKey, "")
    }

    setValue("page", backNavigation.page)
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
      {balance !== undefined && (
        <div className={styles.balanceContainer}>
          <p className={styles.value}>
            {rawQuantity ? formatValueWithPrice(quantityValue.toString(), price) : "$-"}
          </p>

          <button
            className={styles.maxButton}
            onClick={() => {
              const maxAmount = fromBaseUnit(balance, { decimals: amountDecimals })
              if (parseQuantity(rawQuantity)?.eq(maxAmount || 0)) return

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
    <section className={styles.container} aria-label="Transfer form">
      {/* Embedded in the deposit hub (onExit) there is always somewhere to go
          back to — the hub itself — even with a single local option. */}
      {(onExit !== undefined || options.length > 1) && (
        <DepositBackButton onClick={resetToPreviousPage} />
      )}
      {/* Title rule: see DepositSubpage's `title`; withdraw keeps its mode label. */}
      <h3 className={styles.title}>
        {mode === "deposit"
          ? `Deposit ${localAsset.symbol} via wallet`
          : `${modeConfig.label} ${localAsset.symbol}`}
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

      {(chainsError || balancesError) && (
        <DepositStatus error>Failed to load balances</DepositStatus>
      )}
      {!canRenderPreviewFooter ? (
        <Footer>
          <Button.White
            type="submit"
            loading={isRouteTransitioning && "Fetching route..."}
            disabled={true}
            fullWidth
          >
            {routeStatusText}
          </Button.White>
        </Footer>
      ) : (
        <FooterWithAddressList>
          {(addressList) => (
            <FooterWithSignedOpHook>
              {(signedOpHook) => (
                <FooterWithMsgs addressList={addressList} signedOpHook={signedOpHook}>
                  {(tx, { isFetchingMessages, messageRefreshError }) => (
                    <FooterWithTxFee tx={tx}>
                      {(gas, { isEstimatingGas }) => (
                        <AsyncBoundary
                          suspenseFallback={
                            <Footer>
                              <Button.White loading="Estimating gas..." disabled fullWidth />
                            </Footer>
                          }
                        >
                          <TransferFooter
                            tx={tx}
                            gas={gas}
                            isRouteTransitioning={isRouteTransitioning}
                            isFetchingMessages={isFetchingMessages}
                            isEstimatingGas={isEstimatingGas}
                            messageRefreshError={messageRefreshError}
                          />
                        </AsyncBoundary>
                      )}
                    </FooterWithTxFee>
                  )}
                </FooterWithMsgs>
              )}
            </FooterWithSignedOpHook>
          )}
        </FooterWithAddressList>
      )}
    </section>
  )
}

export default TransferFields
