import BigNumber from "bignumber.js"
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx"
import { useMutation, useQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { useFormContext } from "react-hook-form"
import { InitiaAddress, formatAmount, toBaseUnit, fromBaseUnit } from "@initia/utils"
import { formatValue } from "@/lib/format"
import { DEFAULT_GAS_ADJUSTMENT } from "@/public/data/constants"
import { useInterwovenKit } from "@/public/data/hooks"
import { STALE_TIMES } from "@/data/http"
import { useChain, usePricesQuery } from "@/data/chains"
import { useAsset } from "@/data/assets"
import { useBalances } from "@/data/account"
import { useGasPrices, useLastFeeDenom } from "@/data/fee"
import Page from "@/components/Page"
import Footer from "@/components/Footer"
import Button from "@/components/Button"
import ChainAssetQuantityLayout from "@/components/form/ChainAssetQuantityLayout"
import ModalTrigger from "@/components/ModalTrigger"
import AssetOnChainButton from "@/components/form/AssetOnChainButton"
import BalanceButton from "@/components/form/BalanceButton"
import QuantityInput from "@/components/form/QuantityInput"
import RecipientInput from "@/components/form/RecipientInput"
import InputHelp from "@/components/form/InputHelp"
import FormHelp from "@/components/form/FormHelp"
import { calcMaxAmount } from "./max"
import type { FormValues } from "./Send"
import SelectChainAsset from "./SelectChainAsset"
import styles from "./SendFields.module.css"

const queryKeys = createQueryKeys("interwovenkit:send", {
  gas: (params) => [params],
})

export const SendFields = () => {
  const { address, initiaAddress, estimateGas, requestTxSync } = useInterwovenKit()

  const { register, watch, setValue, handleSubmit, formState } = useFormContext<FormValues>()
  const { chainId, denom, recipient, quantity, memo } = watch()

  const chain = useChain(chainId)
  const balances = useBalances(chain)
  const gasPrices = useGasPrices(chain)
  const lastFeeDenom = useLastFeeDenom(chain, { enabled: chain.fees.fee_tokens.length >= 2 })
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

  const gas = Math.ceil(estimatedGas * DEFAULT_GAS_ADJUSTMENT)
  const maxAmount = calcMaxAmount({ denom, balances, gasPrices, lastFeeDenom, gas })

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
      return requestTxSync({
        messages,
        memo,
        chainId,
        gas: estimatedGas,
        gasAdjustment: DEFAULT_GAS_ADJUSTMENT,
        gasPrices: gasPrices,
        spendCoins: [{ denom, amount }],
        internal: "/",
      })
    },
  })

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
                disabled={gasPrices.some(({ denom: feeDenom }) => feeDenom === denom) && isLoading}
              >
                {formatAmount(balance ?? "0", { decimals })}
              </BalanceButton>
            }
            value={!quantity ? "$0" : !price ? "$-" : formatValue(BigNumber(quantity).times(price))}
            errorMessage={formState.errors.quantity?.message}
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
            <InputHelp level="error">{formState.errors.memo?.message}</InputHelp>
          </div>

          <FormHelp.Stack>
            {!memo && (
              <FormHelp level="warning">Check if the above transaction requires a memo</FormHelp>
            )}
          </FormHelp.Stack>
        </div>

        <Footer>
          <Button.White
            type="submit"
            loading={isLoading || isPending}
            disabled={!formState.isValid}
          >
            Confirm
          </Button.White>
        </Footer>
      </form>
    </Page>
  )
}

export default SendFields
