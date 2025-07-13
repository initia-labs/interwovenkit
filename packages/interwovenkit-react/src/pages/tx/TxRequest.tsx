import ky from "ky"
import { descend } from "ramda"
import BigNumber from "bignumber.js"
import { sentenceCase } from "change-case"
import type { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin"
import { calculateFee, GasPrice } from "@cosmjs/stargate"
import { useState } from "react"
import { useMutation, useSuspenseQuery } from "@tanstack/react-query"
import { useInitiaAddress } from "@/public/data/hooks"
import { DEFAULT_GAS_PRICE_MULTIPLIER } from "@/public/data/constants"
import { LocalStorageKey } from "@/data/constants"
import { useBalances } from "@/data/account"
import { chainQueryKeys, useChain } from "@/data/chains"
import { useSignWithEthSecp256k1, useOfflineSigner } from "@/data/signer"
import { normalizeError, STALE_TIMES } from "@/data/http"
import { TX_APPROVAL_MUTATION_KEY, useTxRequestHandler } from "@/data/tx"
import WidgetAccordion from "@/components/WidgetAccordion"
import Scrollable from "@/components/Scrollable"
import FormHelp from "@/components/form/FormHelp"
import Footer from "@/components/Footer"
import Button from "@/components/Button"
import TxMetaItem from "./TxMetaItem"
import TxFee from "./TxFee"
import TxMessage from "./TxMessage"
import styles from "./TxRequest.module.css"

const TxRequest = () => {
  const { txRequest, resolve, reject } = useTxRequestHandler()
  const { messages, memo, chainId, gas, gasAdjustment } = txRequest

  const address = useInitiaAddress()
  const signer = useOfflineSigner()
  const signWithEthSecp256k1 = useSignWithEthSecp256k1()
  const chain = useChain(chainId)
  const balances = useBalances(chain)

  const { data: gasPrices } = useSuspenseQuery({
    queryKey: chainQueryKeys.gasPrices(chain).queryKey,
    queryFn: async () => {
      if (chain.metadata?.is_l1) {
        const { restUrl } = chain
        const { gas_prices } = await ky
          .create({ prefixUrl: restUrl })
          .get("initia/tx/v1/gas_prices")
          .json<{ gas_prices: Coin[] }>()
        return gas_prices
          .toSorted(descend(({ denom }) => denom === "uinit"))
          .map(({ denom, amount }) => {
            const price = BigNumber(amount).times(DEFAULT_GAS_PRICE_MULTIPLIER).toFixed(18)
            return GasPrice.fromString(price + denom)
          })
      }
      return chain.fees.fee_tokens.map(({ denom, fixed_min_gas_price }) =>
        GasPrice.fromString(fixed_min_gas_price + denom),
      )
    },
    staleTime: STALE_TIMES.SECOND,
  })

  const feeOptions = gasPrices.map((gasPrice) =>
    calculateFee(Math.ceil(gas * gasAdjustment), gasPrice),
  )

  const feeCoins = feeOptions.map((fee) => fee.amount[0])

  const canPayFee = (feeDenom: string) => {
    const balance = balances.find((balance) => balance.denom === feeDenom)?.amount ?? 0
    const feeOption = feeCoins.find((coin) => coin.denom === feeDenom)?.amount ?? 0
    return BigNumber(balance).gte(feeOption)
  }

  const localStorageKey = `${LocalStorageKey.FEE_DENOM}:${chainId}`
  const getInitialFeeDenom = () => {
    const savedFeeDenom = localStorage.getItem(localStorageKey)
    if (savedFeeDenom && canPayFee(savedFeeDenom)) {
      return savedFeeDenom
    }

    for (const { denom: feeDenom } of feeCoins) {
      if (canPayFee(feeDenom)) {
        return feeDenom
      }
    }

    return feeCoins[0].denom
  }

  const [feeDenom, setFeeDenom] = useState(getInitialFeeDenom)

  const { mutate: approve, isPending } = useMutation({
    mutationKey: [TX_APPROVAL_MUTATION_KEY],
    mutationFn: async () => {
      const fee = feeOptions.find((fee) => fee.amount[0].denom === feeDenom)
      if (!fee) throw new Error("Fee not found")
      if (!signer) throw new Error("Signer not initialized")
      const signedTx = await signWithEthSecp256k1(chainId, address, messages, fee, memo)
      await resolve(signedTx)
    },
    onMutate: () => {
      localStorage.setItem(localStorageKey, feeDenom)
    },
    onError: async (error: Error) => {
      reject(new Error(await normalizeError(error)))
    },
  })

  const isInsufficient = !canPayFee(feeDenom)

  return (
    <>
      <Scrollable>
        <h1 className={styles.title}>Confirm tx</h1>

        <div className={styles.meta}>
          <TxMetaItem title="Chain" content={chainId} />
          <TxMetaItem
            title="Tx fee"
            content={<TxFee options={feeOptions} value={feeDenom} onChange={setFeeDenom} />}
          />
          {memo && <TxMetaItem title="Memo" content={memo} />}
          {isInsufficient && <FormHelp level="error">Insufficient balance for fee</FormHelp>}
        </div>

        <WidgetAccordion
          list={messages}
          renderHeader={({ typeUrl }) =>
            sentenceCase(typeUrl.split(".").pop()!.replace(/^Msg/, ""))
          }
          renderContent={(message) => <TxMessage message={message} chainId={chainId} />}
        />
      </Scrollable>

      <Footer className={styles.footer}>
        <Button.Outline onClick={() => reject(new Error("User rejected"))} disabled={isPending}>
          Reject
        </Button.Outline>
        <Button.White onClick={() => approve()} disabled={isInsufficient} loading={isPending}>
          Approve
        </Button.White>
      </Footer>
    </>
  )
}

export default TxRequest
