import BigNumber from "bignumber.js"
import type { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin"
import { useId, useState } from "react"
import { fromBaseUnit, toBaseUnit } from "@initia/utils"
import Button from "@/components/Button"
import Dropdown from "@/components/Dropdown"
import FormHelp from "@/components/form/FormHelp"
import { useAssets } from "@/data/assets"
import { useChain } from "@/data/chains"
import { useConfig } from "@/data/config"
import { useUpdateAutoSignFeeAllowance } from "@/pages/autosign/data/actions"
import styles from "./FeeAllowanceEditor.module.css"

interface Props {
  chainId: string
  grantee: string
  spendLimit: Coin[]
}

const FeeAllowanceEditor = ({ chainId, grantee, spendLimit }: Props) => {
  const chain = useChain(chainId)
  const assets = useAssets(chain)
  const configuredBudget = useConfig().autoSignGrantPolicy?.[chainId]?.feeBudget ?? []
  const feeAssets = chain.fees.fee_tokens.flatMap(({ denom }) => {
    const asset = assets.find((candidate) => candidate.denom === denom)
    return asset && Number.isInteger(asset.decimals) && asset.decimals >= 0 ? [asset] : []
  })
  const initialDenom =
    spendLimit[0]?.denom ?? configuredBudget[0]?.denom ?? feeAssets[0]?.denom ?? ""
  const initialAsset = feeAssets.find((asset) => asset.denom === initialDenom)
  const initialCoin =
    spendLimit.find((coin) => coin.denom === initialDenom) ??
    configuredBudget.find((coin) => coin.denom === initialDenom)
  const initialAmount =
    initialCoin && initialAsset
      ? fromBaseUnit(initialCoin.amount, { decimals: initialAsset.decimals })
      : ""
  const canEdit =
    spendLimit.length <= 1 && feeAssets.length > 0 && (spendLimit.length === 0 || !!initialAsset)

  const [limitFees, setLimitFees] = useState(spendLimit.length > 0)
  const [denom, setDenom] = useState(initialDenom)
  const [amount, setAmount] = useState(initialAmount)
  const [error, setError] = useState("")
  const errorId = useId()
  const update = useUpdateAutoSignFeeAllowance()
  const asset = feeAssets.find((candidate) => candidate.denom === denom)
  const isDirty =
    limitFees !== spendLimit.length > 0 ||
    (limitFees && (denom !== initialDenom || amount !== initialAmount))

  const handleDenomChange = (nextDenom: string) => {
    setDenom(nextDenom)
    const nextAsset = feeAssets.find((candidate) => candidate.denom === nextDenom)
    const suggested = configuredBudget.find((coin) => coin.denom === nextDenom)
    setAmount(
      suggested && nextAsset
        ? fromBaseUnit(suggested.amount, { decimals: nextAsset.decimals })
        : "",
    )
  }

  const handleSave = async () => {
    setError("")
    const [, fractional = ""] = amount.split(".")
    const isValidAmount =
      /^\d+(?:\.\d+)?$/.test(amount) &&
      !!asset &&
      fractional.length <= asset.decimals &&
      BigNumber(amount || 0).gt(0)
    if (limitFees && (!asset || !isValidAmount)) {
      setError("Enter a fee budget above 0.")
      return
    }

    try {
      await update.mutateAsync({
        chainId,
        grantee,
        feeBudget:
          limitFees && asset
            ? [
                {
                  denom,
                  amount: toBaseUnit(amount, { decimals: asset.decimals }),
                },
              ]
            : undefined,
      })
    } catch (updateError) {
      setError(
        updateError instanceof Error ? updateError.message : "Unable to update the fee allowance.",
      )
    }
  }

  return (
    <details className={styles.details}>
      <summary>Advanced settings</summary>
      <div className={styles.content}>
        {!canEdit ? (
          <p className={styles.note}>
            {spendLimit.length > 1
              ? "This allowance uses multiple fee tokens and cannot be edited here."
              : "No verified fee token is available for editing."}
          </p>
        ) : (
          <>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                aria-label="Limit total fees"
                checked={limitFees}
                onChange={(event) => setLimitFees(event.target.checked)}
                disabled={update.isPending}
              />
              <span>
                <strong>Limit total fees</strong>
                <small>Set a cumulative budget for fees paid from your wallet.</small>
              </span>
            </label>
            {limitFees && asset && (
              <label className={styles.field}>
                <span>Total fee budget</span>
                <div className={styles.inputRow}>
                  <input
                    value={amount}
                    aria-label="Total fee budget"
                    onChange={(event) => setAmount(event.target.value)}
                    inputMode="decimal"
                    autoComplete="off"
                    aria-invalid={!!error}
                    aria-describedby={error ? errorId : undefined}
                  />
                  {feeAssets.length > 1 ? (
                    <Dropdown
                      options={feeAssets.map((feeAsset) => ({
                        value: feeAsset.denom,
                        label: feeAsset.symbol || feeAsset.denom,
                      }))}
                      value={denom}
                      onChange={handleDenomChange}
                      classNames={{ trigger: styles.denomTrigger, item: styles.denomItem }}
                    />
                  ) : (
                    <span>{asset.symbol || denom}</span>
                  )}
                </div>
              </label>
            )}
            {!limitFees && (
              <p className={styles.note}>
                Auto-signing can spend your available fee-token balance on fees.
              </p>
            )}
            <p className={styles.note}>
              This does not limit transaction value. Changing the allowance requires approval in
              your main wallet.
            </p>
            {error && (
              <div id={errorId}>
                <FormHelp level="error">{error}</FormHelp>
              </div>
            )}
            <Button.Small onClick={handleSave} disabled={update.isPending || !isDirty}>
              {update.isPending ? "Preparing..." : "Review fee change"}
            </Button.Small>
          </>
        )}
      </div>
    </details>
  )
}

export default FeeAllowanceEditor
