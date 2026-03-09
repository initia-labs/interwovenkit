import type { StdFee } from "@cosmjs/stargate"
import { calculateFee, GasPrice } from "@cosmjs/stargate"
import type { TxJson } from "@skip-go/client"
import BigNumber from "bignumber.js"
import { type ReactNode, useEffect, useEffectEvent, useState } from "react"
import { formatAmount } from "@initia/utils"
import Dropdown, { type DropdownOption } from "@/components/Dropdown"
import { useBalances } from "@/data/account"
import { useFindAsset } from "@/data/assets"
import { useChain } from "@/data/chains"
import { useGasPrices, useLastFeeDenom } from "@/data/fee"
import { DEFAULT_GAS_ADJUSTMENT } from "@/public/data/constants"
import BridgePreviewFooter from "../bridge/BridgePreviewFooter"
import { useAllSkipAssets } from "../bridge/data/assets"
import { type BridgeTxResult, useBridgePreviewState } from "../bridge/data/tx"
import FooterWithErc20Approval from "../bridge/FooterWithErc20Approval"
import { type TransferMode, useTransferForm } from "./hooks"
import styles from "./TransferFooter.module.css"

type FeeRenderer = (() => ReactNode) | undefined

interface Props {
  tx: TxJson
  gas: number | null
  mode: TransferMode
  isRouteTransitioning?: boolean
  isFetchingMessages?: boolean
  isEstimatingGas?: boolean
  onFeeRendererChange?: (renderer: FeeRenderer) => void
}

interface FooterWithFeeProps extends Omit<Props, "gas" | "mode"> {
  gas: number
  confirmMessage: "Deposit" | "Withdraw"
  onCompleted: (result: BridgeTxResult) => void
}

const TransferFooterWithFee = ({
  tx,
  gas,
  confirmMessage,
  onCompleted,
  isRouteTransitioning,
  isFetchingMessages,
  isEstimatingGas,
  onFeeRendererChange,
}: FooterWithFeeProps) => {
  const { values } = useBridgePreviewState()
  const { srcChainId, srcDenom, quantity } = values
  const skipAssets = useAllSkipAssets()
  const srcAsset = skipAssets.find(
    ({ denom, chain_id }) => denom === srcDenom && chain_id === srcChainId,
  )

  // Fee calculation for cosmos transactions
  const chain = useChain(srcChainId)
  const balances = useBalances(chain)
  const gasPrices = useGasPrices(chain)
  const lastUsedFeeDenom = useLastFeeDenom(chain)
  const findAsset = useFindAsset(chain)

  // Only calculate fees for cosmos transactions with valid gas
  const feeOptions: StdFee[] = gasPrices.map(({ amount, denom }) =>
    calculateFee(Math.ceil(gas * DEFAULT_GAS_ADJUSTMENT), GasPrice.fromString(amount + denom)),
  )

  const feeOptionsByDenom = new Map(
    feeOptions.map((fee) => {
      const [{ denom }] = fee.amount
      return [denom, fee]
    }),
  )
  const balancesByDenom = new Map(balances.map(({ denom, amount }) => [denom, amount]))
  const sourceSpendAmount = srcAsset
    ? BigNumber(quantity || "0")
        .times(BigNumber(10).pow(srcAsset.decimals))
        .toFixed(0)
    : "0"
  const feeDetailsByDenom = new Map(
    feeOptions.map((fee) => {
      const [{ amount, denom }] = fee.amount
      const balance = balancesByDenom.get(denom) ?? "0"
      const spendAmount = srcAsset && srcDenom === denom ? sourceSpendAmount : "0"
      const totalRequired = BigNumber(amount).plus(spendAmount)
      const { symbol, decimals } = findAsset(denom)

      return [
        denom,
        {
          symbol,
          decimals,
          spend: BigNumber(spendAmount).gt(0) ? spendAmount : null,
          fee: amount,
          total: totalRequired.toFixed(),
          balance,
          isSufficient: BigNumber(balance).gte(totalRequired),
        },
      ]
    }),
  )
  const [preferredFeeDenom, setPreferredFeeDenom] = useState<string | null>(null)
  const loadingStateProps = { isRouteTransitioning, isFetchingMessages, isEstimatingGas }

  const feeDenom = (() => {
    if (preferredFeeDenom && feeDetailsByDenom.get(preferredFeeDenom)?.isSufficient) {
      return preferredFeeDenom
    }

    if (lastUsedFeeDenom && feeDetailsByDenom.get(lastUsedFeeDenom)?.isSufficient) {
      return lastUsedFeeDenom
    }

    for (const fee of feeOptions) {
      const [{ denom }] = fee.amount
      if (feeDetailsByDenom.get(denom)?.isSufficient) {
        return denom
      }
    }

    return feeOptions[0]?.amount[0].denom
  })()

  const selectedFee = feeDenom ? feeOptionsByDenom.get(feeDenom) : undefined

  // Check if balance is sufficient for both fee and transfer amount
  const feeDetails = feeDenom ? feeDetailsByDenom.get(feeDenom) : null
  const balanceError = feeDetails && !feeDetails.isSufficient ? "Insufficient balance" : undefined

  // Helper functions for fee display
  const getDp = (amount: string, decimals: number) => {
    if (formatAmount(amount, { decimals }) === "0.000000") return 8
    return undefined
  }

  const getFeeLabel = (fee: StdFee) => {
    const [{ amount, denom }] = fee.amount
    if (BigNumber(amount).isZero()) return "0"
    const { symbol, decimals } = findAsset(denom)
    const dp = getDp(amount, decimals)
    return `${formatAmount(amount, { decimals, dp })} ${symbol}`
  }

  const renderFee = () => {
    if (feeOptions.length === 0) return null

    // Single fee option - just display it
    if (feeOptions.length === 1) {
      return <span className="monospace">{getFeeLabel(feeOptions[0])}</span>
    }

    // Multiple fee options - show dropdown
    if (!selectedFee || !feeDenom) return null

    const dropdownOptions: DropdownOption<string>[] = feeOptions.map((option) => {
      const [{ denom }] = option.amount
      const { symbol } = findAsset(denom)

      return {
        value: denom,
        label: getFeeLabel(option),
        triggerLabel: symbol,
      }
    })

    const [{ amount, denom }] = selectedFee.amount
    const { decimals } = findAsset(denom)
    const dp = getDp(amount, decimals)

    return (
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span className="monospace">{formatAmount(amount, { decimals, dp })}</span>
        <Dropdown
          options={dropdownOptions}
          value={feeDenom}
          onChange={setPreferredFeeDenom}
          classNames={styles}
        />
      </div>
    )
  }

  const selectedFeeAmount = selectedFee?.amount[0].amount
  const feeKey = feeOptions.length > 0 ? `${feeDenom}:${selectedFeeAmount}` : null

  const getRenderer = useEffectEvent((): FeeRenderer => {
    return feeKey ? () => renderFee() : undefined
  })

  useEffect(() => {
    onFeeRendererChange?.(getRenderer())
    return () => onFeeRendererChange?.(undefined)
  }, [feeKey, onFeeRendererChange])

  return (
    <FooterWithErc20Approval tx={tx}>
      <BridgePreviewFooter
        tx={tx}
        fee={selectedFee}
        onCompleted={onCompleted}
        confirmMessage={confirmMessage}
        error={balanceError}
        {...loadingStateProps}
      />
    </FooterWithErc20Approval>
  )
}

const TransferFooter = ({
  tx,
  gas,
  mode,
  isRouteTransitioning,
  isFetchingMessages,
  isEstimatingGas,
  onFeeRendererChange,
}: Props) => {
  const { setValue } = useTransferForm()
  const loadingStateProps = { isRouteTransitioning, isFetchingMessages, isEstimatingGas }

  const onCompleted = (result: BridgeTxResult) => {
    setValue("page", "completed")
    setValue("result", result)
  }

  const confirmMessage = mode === "withdraw" ? "Withdraw" : "Deposit"

  if (!gas || !("cosmos_tx" in tx)) {
    return (
      <FooterWithErc20Approval tx={tx}>
        <BridgePreviewFooter
          tx={tx}
          fee={undefined}
          onCompleted={onCompleted}
          confirmMessage={confirmMessage}
          {...loadingStateProps}
        />
      </FooterWithErc20Approval>
    )
  }

  return (
    <TransferFooterWithFee
      tx={tx}
      gas={gas}
      onCompleted={onCompleted}
      confirmMessage={confirmMessage}
      onFeeRendererChange={onFeeRendererChange}
      {...loadingStateProps}
    />
  )
}

export default TransferFooter
