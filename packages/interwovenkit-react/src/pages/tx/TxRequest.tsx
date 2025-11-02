import { calculateFee, GasPrice } from "@cosmjs/stargate"
import BigNumber from "bignumber.js"
import { sentenceCase } from "change-case"
import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import FormHelp from "@/components/form/FormHelp"
import Scrollable from "@/components/Scrollable"
import WidgetAccordion from "@/components/WidgetAccordion"
import { useBalances } from "@/data/account"
import { useFindAsset } from "@/data/assets"
import { useChain } from "@/data/chains"
import { useGasPrices, useLastFeeDenom } from "@/data/fee"
import { useSignWithEthSecp256k1 } from "@/data/signer"
import { TX_APPROVAL_MUTATION_KEY, useTxRequestHandler } from "@/data/tx"
import { useInitiaAddress } from "@/public/data/hooks"
import { useValidateAutoSign } from "../autosign/data/validation"
import { useSignWithEmbeddedWallet } from "../autosign/data/wallet"
import TxFee from "./TxFee"
import TxFeeInsufficient from "./TxFeeInsufficient"
import TxMessage from "./TxMessage"
import TxMetaItem from "./TxMetaItem"
import TxSimulate from "./TxSimulate"
import styles from "./TxRequest.module.css"

const TxRequest = () => {
  const { txRequest, resolve, reject } = useTxRequestHandler()
  const { messages, memo, chainId, gas, gasAdjustment, spendCoins } = txRequest

  const address = useInitiaAddress()
  const signWithEthSecp256k1 = useSignWithEthSecp256k1()
  const chain = useChain(chainId)
  const balances = useBalances(chain)
  const gasPrices = useGasPrices(chain)
  const lastUsedFeeDenom = useLastFeeDenom(chain)
  const findAsset = useFindAsset(chain)
  const validateAutoSign = useValidateAutoSign()
  const signWithEmbeddedWallet = useSignWithEmbeddedWallet()

  const feeOptions = (txRequest.gasPrices ?? gasPrices).map(({ amount, denom }) =>
    calculateFee(Math.ceil(gas * gasAdjustment), GasPrice.fromString(amount + denom)),
  )

  const feeCoins = feeOptions.map((fee) => fee.amount[0])

  const getFeeDetails = (feeDenom: string) => {
    const balance = balances.find((balance) => balance.denom === feeDenom)?.amount ?? "0"
    const feeAmount = feeCoins.find((coin) => coin.denom === feeDenom)?.amount ?? "0"
    const spendAmount = spendCoins
      .filter((coin) => coin.denom === feeDenom)
      .reduce((total, coin) => BigNumber(total).plus(coin.amount), BigNumber("0"))
    const totalRequired = BigNumber(feeAmount).plus(spendAmount)
    const isSufficient = BigNumber(balance).gte(totalRequired)

    const { symbol, decimals } = findAsset(feeDenom)

    return {
      symbol,
      decimals,
      spend: spendAmount.gt(0) ? spendAmount.toFixed() : null,
      fee: feeAmount,
      total: totalRequired.toFixed(),
      balance,
      isSufficient,
    }
  }

  const getInitialFeeDenom = () => {
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

  const { mutate: approve, isPending } = useMutation({
    mutationKey: [TX_APPROVAL_MUTATION_KEY],
    mutationFn: async () => {
      const fee = feeOptions.find((fee) => fee.amount[0].denom === feeDenom)
      if (!fee) throw new Error("Fee not found")

      const isAutoSignValid = !txRequest.internal && (await validateAutoSign(chainId, messages))
      const signedTx = isAutoSignValid
        ? await signWithEmbeddedWallet(chainId, address, messages, fee, memo || "")
        : await signWithEthSecp256k1(chainId, address, messages, fee, memo)

      await resolve(signedTx)
    },
    onError: async (error: Error) => {
      reject(error)
    },
  })

  const feeDetails = getFeeDetails(feeDenom)
  const isInsufficient = !feeDetails.isSufficient

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
          {isInsufficient && (
            <FormHelp level="error">
              <TxFeeInsufficient {...feeDetails} />
            </FormHelp>
          )}
        </div>

        <TxSimulate messages={messages} memo={memo} chainId={chainId} />

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
