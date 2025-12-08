import type { StdFee } from "@cosmjs/stargate"
import { calculateFee, GasPrice } from "@cosmjs/stargate"
import type { TxJson } from "@skip-go/client"
import BigNumber from "bignumber.js"
import { useState } from "react"
import { useToggle } from "usehooks-ts"
import { IconChevronUp } from "@initia/icons-react"
import { formatAmount, truncate } from "@initia/utils"
import Dropdown, { type DropdownOption } from "@/components/Dropdown"
import { useBalances } from "@/data/account"
import { useFindAsset } from "@/data/assets"
import { useChain } from "@/data/chains"
import { useGasPrices, useLastFeeDenom } from "@/data/fee"
import { useConnectedWalletIcon } from "@/hooks/useConnectedWalletIcon"
import { useLocationState } from "@/lib/router"
import { DEFAULT_GAS_ADJUSTMENT } from "@/public/data/constants"
import { useInitiaAddress } from "@/public/data/hooks"
import BridgePreviewFooter from "../bridge/BridgePreviewFooter"
import { useAllSkipAssets } from "../bridge/data/assets"
import { formatDuration } from "../bridge/data/format"
import type { RouterRouteResponseJson } from "../bridge/data/simulate"
import { useBridgePreviewState } from "../bridge/data/tx"
import FooterWithErc20Approval from "../bridge/FooterWithErc20Approval"
import styles from "./DepositFields.module.css"

interface Props {
  tx: TxJson
  gas: number | null
}

const DepositFooter = ({ tx, gas }: Props) => {
  const { route } = useLocationState<{ route?: RouterRouteResponseJson }>()
  const { values } = useBridgePreviewState()
  const { srcChainId, dstDenom, dstChainId, srcDenom, quantity } = values
  const skipAssets = useAllSkipAssets()
  const dstAsset = skipAssets.find(
    ({ denom, chain_id }) => denom === dstDenom && chain_id === dstChainId,
  )
  const srcAsset = skipAssets.find(
    ({ denom, chain_id }) => denom === srcDenom && chain_id === srcChainId,
  )
  const address = useInitiaAddress()
  const walletIcon = useConnectedWalletIcon()

  const [isDetailsOpen, toggleDetails] = useToggle(false)

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
      {route && dstAsset && (
        <div className={styles.detailsContainer}>
          <button className={styles.detailsButton} onClick={toggleDetails}>
            Transaction details{" "}
            <IconChevronUp
              size={12}
              style={{ transform: isDetailsOpen ? "rotate(180deg)" : "rotate(0deg)" }}
            />
          </button>
          {isDetailsOpen && (
            <>
              <div className={styles.detail}>
                <p className={styles.detailLabel}>Estimated time</p>
                <p className={styles.detailValue}>
                  {formatDuration(route.estimated_route_duration_seconds)}
                </p>
              </div>
              {address && (
                <div className={styles.detail}>
                  <p className={styles.detailLabel}>Receiving address</p>
                  <p className={styles.detailValue}>
                    <img src={walletIcon} alt="Wallet" /> {truncate(address)}
                  </p>
                </div>
              )}
            </>
          )}
          <div className={styles.detail}>
            <p className={styles.detailLabel}>Minimum received</p>
            <p className={styles.detailValue}>
              <img src={dstAsset.logo_uri} alt={dstAsset.symbol} />{" "}
              {formatAmount(route.estimated_amount_out, { decimals: dstAsset.decimals })}{" "}
              {dstAsset.symbol}
            </p>
          </div>
          {feeOptions && feeOptions.length > 0 && (
            <div className={styles.detail}>
              <p className={styles.detailLabel}>Tx fee</p>
              <p className={styles.detailValue}>{renderFee()}</p>
            </div>
          )}
        </div>
      )}
      <FooterWithErc20Approval tx={tx}>
        <BridgePreviewFooter tx={tx} fee={selectedFee} navigateTo="/deposit/completed" />
      </FooterWithErc20Approval>
    </>
  )
}

export default DepositFooter
