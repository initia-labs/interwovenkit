import type { StdFee } from "@cosmjs/stargate"
import { calculateFee, GasPrice } from "@cosmjs/stargate"
import type { TxJson } from "@skip-go/client"
import BigNumber from "bignumber.js"
import { useState } from "react"
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
import TransferTxDetails from "./TransferTxDetails"
import styles from "./TransferFooter.module.css"

interface Props {
  tx: TxJson
  gas: number | null
  mode: TransferMode
}

interface FooterBaseProps {
  tx: TxJson
  confirmMessage: "Deposit" | "Withdraw"
  onCompleted: (result: BridgeTxResult) => void
}

interface FooterWithFeeProps extends FooterBaseProps {
  gas: number
}

const TransferFooterWithFee = ({ tx, gas, confirmMessage, onCompleted }: FooterWithFeeProps) => {
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

  const feeCoins = feeOptions.map((fee) => fee.amount[0])

  const getFeeDetails = (feeDenom: string) => {
    const balance = balances.find((balance) => balance.denom === feeDenom)?.amount ?? "0"
    const feeAmount = feeCoins.find((coin) => coin.denom === feeDenom)?.amount ?? "0"

    // Calculate spend amount from the source asset
    const spendAmount =
      srcAsset && srcDenom === feeDenom
        ? BigNumber(quantity || "0")
            .times(BigNumber(10).pow(srcAsset.decimals))
            .toFixed(0)
        : "0"

    const totalRequired = BigNumber(feeAmount).plus(spendAmount)
    const isSufficient = BigNumber(balance).gte(totalRequired)

    const { symbol, decimals } = findAsset(feeDenom)

    return {
      symbol,
      decimals,
      spend: BigNumber(spendAmount).gt(0) ? spendAmount : null,
      fee: feeAmount,
      total: totalRequired.toFixed(),
      balance,
      isSufficient,
    }
  }

  const getInitialFeeDenom = () => {
    if (!feeCoins.length) return null

    if (lastUsedFeeDenom && getFeeDetails(lastUsedFeeDenom).isSufficient) {
      return lastUsedFeeDenom
    }

    for (const { denom: feeDenom } of feeCoins) {
      if (getFeeDetails(feeDenom).isSufficient) {
        return feeDenom
      }
    }

    return feeCoins[0]?.denom
  }

  const [feeDenom, setFeeDenom] = useState(getInitialFeeDenom)

  const selectedFee = feeOptions.find((fee) => fee.amount[0].denom === feeDenom) ?? undefined

  // Check if balance is sufficient for both fee and transfer amount
  const feeDetails = feeDenom ? getFeeDetails(feeDenom) : null
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
          onChange={setFeeDenom}
          classNames={styles}
        />
      </div>
    )
  }

  return (
    <>
      <TransferTxDetails renderFee={feeOptions.length > 0 ? renderFee : undefined} />
      <FooterWithErc20Approval tx={tx}>
        <BridgePreviewFooter
          tx={tx}
          fee={selectedFee}
          onCompleted={onCompleted}
          confirmMessage={confirmMessage}
          error={balanceError}
        />
      </FooterWithErc20Approval>
    </>
  )
}

const TransferFooterWithoutFee = ({ tx, confirmMessage, onCompleted }: FooterBaseProps) => {
  return (
    <>
      <TransferTxDetails />
      <FooterWithErc20Approval tx={tx}>
        <BridgePreviewFooter
          tx={tx}
          fee={undefined}
          onCompleted={onCompleted}
          confirmMessage={confirmMessage}
        />
      </FooterWithErc20Approval>
    </>
  )
}

const TransferFooter = ({ tx, gas, mode }: Props) => {
  const { setValue } = useTransferForm()

  const onCompleted = (result: BridgeTxResult) => {
    setValue("page", "completed")
    setValue("result", result)
  }

  const confirmMessage = mode === "withdraw" ? "Withdraw" : "Deposit"

  // TransferFooterWithFee assumes `gas` exists and `tx` is a cosmos tx.
  if (!gas || !("cosmos_tx" in tx)) {
    return (
      <TransferFooterWithoutFee tx={tx} onCompleted={onCompleted} confirmMessage={confirmMessage} />
    )
  }

  return (
    <TransferFooterWithFee
      tx={tx}
      gas={gas}
      onCompleted={onCompleted}
      confirmMessage={confirmMessage}
    />
  )
}

export default TransferFooter
