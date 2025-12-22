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
import { useBridgePreviewState } from "../bridge/data/tx"
import FooterWithErc20Approval from "../bridge/FooterWithErc20Approval"
import DepositTxDetails from "./DepositTxDetails"

interface Props {
  tx: TxJson
  gas: number | null
}

const DepositFooterWithFee = ({ tx, gas }: Props) => {
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
  const feeOptions: StdFee[] | null =
    gas && "cosmos_tx" in tx
      ? gasPrices.map(({ amount, denom }) =>
          calculateFee(
            Math.ceil(gas * DEFAULT_GAS_ADJUSTMENT),
            GasPrice.fromString(amount + denom),
          ),
        )
      : null

  const feeCoins = feeOptions?.map((fee) => fee.amount[0]) ?? []

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

  const selectedFee = feeOptions?.find((fee) => fee.amount[0].denom === feeDenom) ?? undefined

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
    if (!feeOptions || feeOptions.length === 0) return null

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
        <Dropdown options={dropdownOptions} value={feeDenom} onChange={setFeeDenom} />
      </div>
    )
  }

  return (
    <>
      <DepositTxDetails renderFee={feeOptions && feeOptions.length > 0 ? renderFee : undefined} />
      <FooterWithErc20Approval tx={tx}>
        <BridgePreviewFooter
          tx={tx}
          fee={selectedFee}
          navigateTo="/deposit/completed"
          confirmMessage="Deposit"
        />
      </FooterWithErc20Approval>
    </>
  )
}

const DepositFooter = ({ tx, gas }: Props) => {
  if (!gas || !("cosmos_tx" in tx)) {
    return (
      <>
        <DepositTxDetails />
        <FooterWithErc20Approval tx={tx}>
          <BridgePreviewFooter
            tx={tx}
            fee={undefined}
            navigateTo="/deposit/completed"
            confirmMessage="Deposit"
          />
        </FooterWithErc20Approval>
      </>
    )
  }

  return <DepositFooterWithFee tx={tx} gas={gas} />
}

export default DepositFooter
