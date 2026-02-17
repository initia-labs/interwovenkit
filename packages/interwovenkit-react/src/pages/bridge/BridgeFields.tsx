import type { FeeJson } from "@skip-go/client"
import BigNumber from "bignumber.js"
import { sentenceCase } from "change-case"
import { isAddress } from "ethers"
import { useCallback, useMemo, useState } from "react"
import { useDebounceValue, useLocalStorage } from "usehooks-ts"
import {
  IconChevronDown,
  IconInfoFilled,
  IconSettingFilled,
  IconWarningFilled,
} from "@initia/icons-react"
import { formatAmount, fromBaseUnit } from "@initia/utils"
import AnimatedHeight from "@/components/AnimatedHeight"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import BalanceButton from "@/components/form/BalanceButton"
import ChainAssetQuantityLayout from "@/components/form/ChainAssetQuantityLayout"
import FormHelp from "@/components/form/FormHelp"
import QuantityInput from "@/components/form/QuantityInput"
import ModalTrigger from "@/components/ModalTrigger"
import PlainModalContent from "@/components/PlainModalContent"
import WidgetTooltip from "@/components/WidgetTooltip"
import { useAnalyticsTrack } from "@/data/analytics"
import { useFindChain, useLayer1 } from "@/data/chains"
import { LocalStorageKey } from "@/data/constants"
import { useIsMobile } from "@/hooks/useIsMobile"
import { formatValue } from "@/lib/format"
import { useNavigate } from "@/lib/router"
import { useModal } from "@/public/app/ModalContext"
import { useSkipAsset } from "./data/assets"
import { useSkipBalance, useSkipBalancesQuery } from "./data/balance"
import { useChainType, useSkipChain } from "./data/chains"
import type { FormValues } from "./data/form"
import { useBridgeForm } from "./data/form"
import { formatDuration, formatFees } from "./data/format"
import { useIsOpWithdrawable, useRouteErrorInfo, useRouteQuery } from "./data/simulate"
import BridgeAccount from "./BridgeAccount"
import SelectedChainAsset from "./SelectedChainAsset"
import type { RouteType } from "./SelectRouteOption"
import SelectRouteOption from "./SelectRouteOption"
import SlippageControl from "./SlippageControl"
import styles from "./BridgeFields.module.css"

function getRouteRefreshMs({
  isLayer1Swap,
  isL2Swap,
}: {
  isLayer1Swap: boolean
  isL2Swap: boolean
}) {
  if (isLayer1Swap) return 5000
  if (isL2Swap) return 2000
  return 10000
}

const BridgeFields = () => {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const track = useAnalyticsTrack()
  const [previewRefreshError, setPreviewRefreshError] = useState<string | undefined>(undefined)
  const [previewRefreshing, setPreviewRefreshing] = useState(false)

  const [selectedType, setSelectedType] = useLocalStorage<RouteType>(
    LocalStorageKey.BRIDGE_ROUTE_TYPE,
    "default",
  )

  // form
  const { watch, setValue, handleSubmit, formState } = useBridgeForm()
  const values = watch()
  const { srcChainId, srcDenom, dstChainId, dstDenom, quantity, sender, slippagePercent } = values

  const findChain = useFindChain()
  const layer1 = useLayer1()
  const srcChain = useSkipChain(srcChainId)
  const srcChainType = useChainType(srcChain)
  const dstChain = useSkipChain(dstChainId)
  const dstChainType = useChainType(dstChain)
  const srcAsset = useSkipAsset(srcDenom, srcChainId)
  const dstAsset = useSkipAsset(dstDenom, dstChainId)
  const { data: balances } = useSkipBalancesQuery(sender, srcChainId)
  const srcBalance = useSkipBalance(sender, srcChainId, srcDenom)

  const hasZeroBalance = !srcBalance?.amount || BigNumber(srcBalance.amount).isZero()

  // simulation
  // Avoid hitting the simulation API on every keystroke.  Wait a short period
  // after the user stops typing before updating the debounced value.
  const [debouncedQuantity] = useDebounceValue(quantity, 300)
  const isSameChainRoute = srcChainId === dstChainId
  const isLayer1Swap = isSameChainRoute && srcChainId === layer1.chainId
  const isL2Swap = isSameChainRoute && srcChainType === "initia" && !isLayer1Swap
  const routeRefreshMs = getRouteRefreshMs({ isLayer1Swap, isL2Swap })

  const isExternalRoute = srcChainType !== "initia" && dstChainType !== "initia"
  const isOpWithdrawable = useIsOpWithdrawable()
  const routeQueryDefault = useRouteQuery(debouncedQuantity, {
    disabled: isExternalRoute,
    refreshMs: routeRefreshMs,
  })
  const routeQueryOpWithdrawal = useRouteQuery(debouncedQuantity, {
    isOpWithdraw: true,
    disabled: !isOpWithdrawable,
    refreshMs: routeRefreshMs,
  })
  const preferOp = isOpWithdrawable && selectedType === "op"
  const preferred = preferOp ? routeQueryOpWithdrawal : routeQueryDefault
  const fallback = preferOp ? routeQueryDefault : routeQueryOpWithdrawal
  const fallbackEnabled = preferOp ? !isExternalRoute : isOpWithdrawable
  const routeQuery = preferred.error && fallbackEnabled ? fallback : preferred
  const { data: route, isLoading, isFetching, error } = routeQuery
  const { data: routeErrorInfo } = useRouteErrorInfo(error)

  const isSimulating = debouncedQuantity && (isLoading || isFetching) && !previewRefreshing

  const flip = () => {
    setValue("srcChainId", dstChainId)
    setValue("srcDenom", dstDenom)
    setValue("dstChainId", srcChainId)
    setValue("dstDenom", srcDenom)
    // Use setValue instead of resetField to prevent localStorage values from appearing unexpectedly
    setValue("quantity", "", { shouldTouch: false, shouldDirty: false })
  }

  // submit
  const { openModal, closeModal } = useModal()
  const submit = handleSubmit(async (values: FormValues) => {
    setPreviewRefreshError(undefined)
    setPreviewRefreshing(true)
    let latestRoute: typeof route
    let quoteVerifiedAt: number
    try {
      const result = await routeQuery.refetch()
      if (result.error || !result.data || !result.dataUpdatedAt) {
        setPreviewRefreshError(
          result.error instanceof Error
            ? result.error.message
            : "Failed to refresh route. Please try again.",
        )
        return
      }
      latestRoute = result.data
      quoteVerifiedAt = result.dataUpdatedAt
    } finally {
      setPreviewRefreshing(false)
    }

    track("Bridge Simulation Success", {
      quantity: values.quantity,
      srcChainId: values.srcChainId,
      srcDenom: values.srcDenom,
      dstChainId: values.dstChainId,
      dstDenom: values.dstDenom,
    })

    if (latestRoute.warning) {
      const { type = "", message } = latestRoute.warning ?? {}
      openModal({
        content: (
          <PlainModalContent
            type="warning"
            icon={<IconWarningFilled size={40} />}
            title={sentenceCase(type)}
            primaryButton={{ label: "Cancel", onClick: closeModal }}
            secondaryButton={{
              label: "Proceed anyway",
              onClick: () => {
                navigate("/bridge/preview", {
                  route: latestRoute,
                  values,
                  quoteVerifiedAt,
                })
                closeModal()
              },
            }}
          >
            <p className={styles.warning}>{message}</p>
          </PlainModalContent>
        ),
      })
      return
    }

    navigate("/bridge/preview", {
      route: latestRoute,
      values,
      quoteVerifiedAt,
    })
  })

  // fees
  const deductedFees = useMemo(() => {
    return (
      route?.estimated_fees?.filter(
        ({ fee_behavior }) => fee_behavior === "FEE_BEHAVIOR_DEDUCTED",
      ) ?? []
    )
  }, [route])

  const additionalFees = useMemo(() => {
    return (
      route?.estimated_fees?.filter(
        ({ fee_behavior }) => fee_behavior === "FEE_BEHAVIOR_ADDITIONAL",
      ) ?? []
    )
  }, [route])

  const feeErrorMessage = useMemo(() => {
    for (const fee of additionalFees) {
      const balance = balances?.[fee.origin_asset.denom]?.amount ?? "0"
      const amount = route?.source_asset_denom === fee.origin_asset.denom ? route.amount_in : "0"
      const insufficient = BigNumber(balance).lt(BigNumber(amount).plus(fee.amount ?? "0"))
      if (insufficient) return `Insufficient ${fee.origin_asset.symbol} for fees`
    }
  }, [balances, route, additionalFees])

  // disabled
  // Note: formState.isValid is not used here because:
  // 1. It was found to not trigger properly (possibly related to balance loading timing)
  // 2. All necessary validations are already performed individually with specific error messages
  // 3. This provides more actionable feedback to users compared to a generic "Invalid values" message
  const disabledMessage = useMemo(() => {
    if (!values.sender) return "Connect wallet"
    if (!values.quantity) return "Enter amount"
    if (!debouncedQuantity) return "Enter amount"
    if (!values.recipient) return "Enter recipient address"
    if (formState.errors.quantity) return formState.errors.quantity.message
    if (!route) return "Route not found"
    if (feeErrorMessage) return feeErrorMessage
  }, [debouncedQuantity, feeErrorMessage, formState, route, values])

  // render
  const received = route ? formatAmount(route.amount_out, { decimals: dstAsset.decimals }) : "0"

  const isMaxAmount =
    BigNumber(quantity).gt(0) &&
    BigNumber(quantity).isEqualTo(
      fromBaseUnit(srcBalance?.amount, { decimals: srcBalance?.decimals ?? 0 }),
    )

  const getIsFeeToken = () => {
    switch (srcChainType) {
      case "initia":
        return findChain(srcChainId).fees.fee_tokens.some(({ denom }) => denom === srcDenom)
      case "cosmos":
        return srcChain.fee_assets.some(({ denom }) => denom === srcDenom)
      case "evm":
        return !isAddress(srcDenom)
      default:
        return false
    }
  }

  const isFeeToken = getIsFeeToken()

  const renderFees = useCallback(
    (fees: FeeJson[], tooltip: string) => {
      if (!fees.length) return null
      return (
        <div className={styles.description}>
          {formatFees(fees)}
          {!isMobile && (
            <WidgetTooltip label={tooltip}>
              <span className={styles.icon}>
                <IconInfoFilled size={12} />
              </span>
            </WidgetTooltip>
          )}
        </div>
      )
    },
    [isMobile],
  )

  const shouldShowRouteOptions =
    BigNumber(quantity).gt(0) &&
    isOpWithdrawable &&
    routeQueryDefault.data &&
    routeQueryOpWithdrawal.data &&
    routeQueryOpWithdrawal.data.estimated_route_duration_seconds >
      routeQueryDefault.data.estimated_route_duration_seconds

  const metaRows = useMemo(() => {
    if (!route) return []

    return [
      {
        condition: !!route.estimated_fees?.length,
        title: "Fees",
        content: (
          <div>
            {renderFees(deductedFees, "Fee deducted from the amount you receive")}
            {renderFees(additionalFees, "Fee charged in addition to the amount you enter")}
          </div>
        ),
      },
      {
        condition:
          !shouldShowRouteOptions && !!formatDuration(route.estimated_route_duration_seconds),
        title: "Estimated time",
        content: (
          <span className={styles.description}>
            {formatDuration(route.estimated_route_duration_seconds)}
          </span>
        ),
      },
      {
        condition: route.does_swap,
        title: "Slippage",
        content: (
          <span className={styles.description}>
            <span>{slippagePercent}%</span>

            <ModalTrigger
              title="Slippage tolerance"
              content={(close) => <SlippageControl afterConfirm={close} />}
              className={styles.edit}
            >
              <IconSettingFilled size={12} />
            </ModalTrigger>
          </span>
        ),
      },
    ].filter((row) => row.condition)
  }, [additionalFees, deductedFees, renderFees, route, shouldShowRouteOptions, slippagePercent])

  return (
    <form className={styles.form} onSubmit={submit}>
      <ChainAssetQuantityLayout
        selectButton={<SelectedChainAsset type="src" />}
        accountButton={srcChainType === "cosmos" && <BridgeAccount type="src" />}
        quantityInput={<QuantityInput balance={srcBalance?.amount} decimals={srcAsset?.decimals} />}
        balanceButton={
          <BalanceButton
            onClick={() =>
              setValue(
                "quantity",
                fromBaseUnit(srcBalance?.amount, { decimals: srcAsset?.decimals ?? 0 }),
                { shouldValidate: true },
              )
            }
            disabled={hasZeroBalance}
          >
            {formatAmount(srcBalance?.amount ?? "0", { decimals: srcAsset.decimals })}
          </BalanceButton>
        }
        value={!route ? "$-" : formatValue(route.usd_amount_in)}
      />

      <div className={styles.arrow}>
        <div className={styles.divider} />
        <button type="button" className={styles.flip} onClick={() => flip()}>
          <IconChevronDown size={16} />
        </button>
      </div>

      <ChainAssetQuantityLayout
        selectButton={<SelectedChainAsset type="dst" />}
        accountButton={<BridgeAccount type="dst" />}
        quantityInput={<QuantityInput.ReadOnly>{received}</QuantityInput.ReadOnly>}
        value={!route ? "$-" : formatValue(route.usd_amount_out)}
        hideNumbers={shouldShowRouteOptions}
      />

      <AnimatedHeight>
        {shouldShowRouteOptions ? (
          <SelectRouteOption.Stack>
            <SelectRouteOption
              label="Fast"
              query={routeQueryDefault}
              value="default"
              onSelect={setSelectedType}
              checked={selectedType === "default"}
            />
            <SelectRouteOption
              label="Lossless"
              query={routeQueryOpWithdrawal}
              value="op"
              onSelect={setSelectedType}
              checked={selectedType === "op"}
            />
          </SelectRouteOption.Stack>
        ) : null}
      </AnimatedHeight>

      <Footer
        extra={
          <>
            <FormHelp.Stack>
              {previewRefreshError && <FormHelp level="error">{previewRefreshError}</FormHelp>}
              {route?.extra_infos?.map((info) => (
                <FormHelp level="info" key={info}>
                  {info}
                </FormHelp>
              ))}
              {routeErrorInfo && <FormHelp level="info">{routeErrorInfo}</FormHelp>}
              {isMaxAmount && isFeeToken && (
                <FormHelp level="warning">Make sure to leave enough for transaction fee</FormHelp>
              )}
              {route?.warning && <FormHelp level="warning">{route.warning.message}</FormHelp>}
              {route?.extra_warnings?.map((warning) => (
                <FormHelp level="warning" key={warning}>
                  {warning}
                </FormHelp>
              ))}
            </FormHelp.Stack>

            <AnimatedHeight>
              {metaRows.length > 0 && (
                <div className={styles.meta}>
                  {metaRows.map((row, index) => (
                    <div className={styles.row} key={index}>
                      <span className={styles.title}>{row.title}</span>
                      {row.content}
                    </div>
                  ))}
                </div>
              )}
            </AnimatedHeight>
          </>
        }
      >
        <Button.White
          loading={previewRefreshing ? "Refreshing route..." : isSimulating && "Simulating..."}
          disabled={!!disabledMessage || previewRefreshing}
        >
          {disabledMessage ?? "Preview route"}
        </Button.White>
      </Footer>
    </form>
  )
}

export default BridgeFields
