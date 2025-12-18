import BigNumber from "bignumber.js"
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx"
import { useMemo } from "react"
import { useFormContext } from "react-hook-form"
import { useMutation, useQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { formatAmount, fromBaseUnit, InitiaAddress, toBaseUnit } from "@initia/utils"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import AssetOnChainButton from "@/components/form/AssetOnChainButton"
import BalanceButton from "@/components/form/BalanceButton"
import ChainAssetQuantityLayout from "@/components/form/ChainAssetQuantityLayout"
import FormHelp from "@/components/form/FormHelp"
import QuantityInput from "@/components/form/QuantityInput"
import RecipientInput from "@/components/form/RecipientInput"
import ModalTrigger from "@/components/ModalTrigger"
import Page from "@/components/Page"
import { useBalances } from "@/data/account"
import { useAsset, useFindAsset } from "@/data/assets"
import { useChain, usePricesQuery } from "@/data/chains"
import { getFeeDetails, useTxFee } from "@/data/fee"
import { STALE_TIMES } from "@/data/http"
import { formatValue } from "@/lib/format"
import TxFee from "@/pages/tx/TxFee"
import TxMeta from "@/pages/tx/TxMeta"
import { useInterwovenKit } from "@/public/data/hooks"
import SelectChainAsset from "./SelectChainAsset"
import type { FormValues } from "./Send"
import styles from "./SendFields.module.css"

const queryKeys = createQueryKeys("interwovenkit:send", {
  gas: (params) => [params],
})

export const SendFields = () => {
  const { address, initiaAddress, estimateGas, submitTxSync } = useInterwovenKit()

  const { register, watch, setValue, handleSubmit, formState } = useFormContext<FormValues>()
  const { errors } = formState
  const { chainId, denom, recipient, quantity, memo } = watch()

  const chain = useChain(chainId)
  const balances = useBalances(chain)
  const findAsset = useFindAsset(chain)
  const asset = useAsset(denom, chain)
  const { data: prices } = usePricesQuery(chain)
  const { decimals } = asset
  const balance = balances.find((coin) => coin.denom === denom)?.amount ?? "0"
  const price = prices?.find(({ id }) => id === denom)?.price

  const { data: estimatedGas = 0, isLoading } = useQuery({
    queryKey: queryKeys.gas({ chainId, denom, recipient, initiaAddress }).queryKey,
    queryFn: () => {
      const messages = [
        {
          typeUrl: "/cosmos.bank.v1beta1.MsgSend",
          value: MsgSend.fromPartial({
            fromAddress: initiaAddress,
            toAddress: InitiaAddress(recipient).bech32,
            amount: [{ denom, amount: "1" }],
          }),
        },
      ]
      return estimateGas({ messages, chainId })
    },
    enabled: InitiaAddress.validate(recipient),
    staleTime: STALE_TIMES.INFINITY,
  })

  const { gasPrices, feeOptions, feeDenom, setFeeDenom, getFee } = useTxFee({ chain, estimatedGas })

  const getSpendAmount = (selectedFeeDenom: string) =>
    denom === selectedFeeDenom && quantity
      ? BigNumber(toBaseUnit(quantity, { decimals }))
      : BigNumber("0")

  const calcFeeDetails = (selectedFeeDenom: string) =>
    getFeeDetails({
      feeDenom: selectedFeeDenom,
      balances,
      feeOptions,
      spendAmount: getSpendAmount(selectedFeeDenom),
      findAsset,
    })

  const feeDetails = calcFeeDetails(feeDenom)
  const isInsufficient = !feeDetails.isSufficient

  // Calculate max amount based on current selected fee
  const maxAmount = useMemo(() => {
    // If sending the same token as fee token
    if (denom === feeDenom) {
      const feeAmount =
        feeOptions.find((fee) => fee.amount[0].denom === feeDenom)?.amount[0]?.amount ?? "0"
      const maxValue = BigNumber(balance).minus(feeAmount)
      return maxValue.gt(0) ? maxValue.toFixed() : "0"
    }
    // If sending different token
    return balance
  }, [denom, feeDenom, feeOptions, balance])

  const hasZeroBalance = BigNumber(balance).isZero()
  const isFeeToken = gasPrices.some(({ denom: feeDenom }) => feeDenom === denom)
  const isEstimatingGas = isFeeToken && isLoading
  const isMaxButtonDisabled = hasZeroBalance || isEstimatingGas

  const { mutate, isPending } = useMutation({
    mutationFn: ({ chainId, denom, quantity, recipient, memo }: FormValues) => {
      const amount = toBaseUnit(quantity, { decimals })
      const messages = [
        {
          typeUrl: "/cosmos.bank.v1beta1.MsgSend",
          value: MsgSend.fromPartial({
            fromAddress: initiaAddress,
            toAddress: InitiaAddress(recipient).bech32,
            amount: [{ denom, amount }],
          }),
        },
      ]

      const fee = getFee()
      if (!fee) throw new Error("Fee not found")

      return submitTxSync({ messages, memo, chainId, fee, internal: "/" })
    },
  })

  const disabledMessage = useMemo(() => {
    if (!quantity) return "Enter amount"
    if (errors.quantity) return errors.quantity.message
    if (!recipient) return "Enter recipient address"
    if (errors.recipient) return errors.recipient.message
    if (errors.memo) return errors.memo.message
    // Destructure error fields in deps to properly track each field change
  }, [quantity, recipient, errors.quantity, errors.recipient, errors.memo])

  return (
    <Page title="Send">
      <form onSubmit={handleSubmit((values) => mutate(values))}>
        <div className={styles.fields}>
          <ChainAssetQuantityLayout
            selectButton={
              <ModalTrigger
                title="Select chain and asset"
                content={(close) => <SelectChainAsset afterSelect={close} />}
              >
                <AssetOnChainButton asset={asset} chain={chain} />
              </ModalTrigger>
            }
            quantityInput={<QuantityInput balance={balance} decimals={decimals} />}
            balanceButton={
              <BalanceButton
                onClick={() =>
                  setValue("quantity", fromBaseUnit(maxAmount, { decimals }), {
                    shouldValidate: true,
                  })
                }
                disabled={isMaxButtonDisabled}
              >
                {formatAmount(maxAmount ?? "0", { decimals })}
              </BalanceButton>
            }
            value={!quantity ? "$0" : !price ? "$-" : formatValue(BigNumber(quantity).times(price))}
          />

          <div className={styles.divider} />

          <RecipientInput myAddress={address} />

          <div>
            <label htmlFor="memo">Memo (optional)</label>
            <input
              {...register("memo", {
                validate: (value) => !value || new Blob([value]).size <= 256 || "Memo is too long",
              })}
              id="memo"
              autoComplete="off"
            />
          </div>

          <FormHelp.Stack>
            {!memo && (
              <FormHelp level="warning">Check if the above transaction requires a memo</FormHelp>
            )}

            {isInsufficient && <FormHelp level="error">Insufficient balance for fee</FormHelp>}

            <TxMeta>
              <TxMeta.Item
                title="Tx fee"
                content={
                  <TxFee
                    chain={chain}
                    options={feeOptions}
                    value={feeDenom}
                    onChange={setFeeDenom}
                  />
                }
              />
            </TxMeta>
          </FormHelp.Stack>
        </div>

        <Footer>
          <Button.White
            type="submit"
            loading={(isLoading ? "Estimating gas..." : false) || isPending}
            disabled={!!disabledMessage || isInsufficient}
          >
            {disabledMessage ?? "Confirm"}
          </Button.White>
        </Footer>
      </form>
    </Page>
  )
}

export default SendFields
