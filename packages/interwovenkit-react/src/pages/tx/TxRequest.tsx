import BigNumber from "bignumber.js"
import { sentenceCase } from "change-case"
import { calculateFee, GasPrice } from "@cosmjs/stargate"
import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { formatAmount } from "@initia/utils"
import { useInitiaAddress } from "@/public/data/hooks"
import { useBalances } from "@/data/account"
import { useChain } from "@/data/chains"
import { useFindAsset } from "@/data/assets"
import { useSignWithEthSecp256k1, useOfflineSigner } from "@/data/signer"
import { TX_APPROVAL_MUTATION_KEY, useTxRequestHandler } from "@/data/tx"
import { useGasPrices, useLastFeeDenom } from "@/data/fee"
import WidgetAccordion from "@/components/WidgetAccordion"
import Scrollable from "@/components/Scrollable"
import FormHelp from "@/components/form/FormHelp"
import Footer from "@/components/Footer"
import Button from "@/components/Button"
import TxMetaItem from "./TxMetaItem"
import TxSimulate from "./TxSimulate"
import TxFee from "./TxFee"
import TxMessage from "./TxMessage"
import TxInsufficientBalance from "./TxInsufficientBalance"
import styles from "./TxRequest.module.css"

const TxRequest = () => {
  const { txRequest, resolve, reject } = useTxRequestHandler()
  const { messages, memo, chainId, gas, gasAdjustment, spendCoins } = txRequest

  const address = useInitiaAddress()
  const signer = useOfflineSigner()
  const signWithEthSecp256k1 = useSignWithEthSecp256k1()
  const chain = useChain(chainId)
  const balances = useBalances(chain)
  const gasPrices = useGasPrices(chain)
  const lastUsedFeeDenom = useLastFeeDenom(chain)
  const findAsset = useFindAsset(chain)

  const feeOptions = (txRequest.gasPrices ?? gasPrices).map(({ amount, denom }) =>
    calculateFee(Math.ceil(gas * gasAdjustment), GasPrice.fromString(amount + denom)),
  )

  const feeCoins = feeOptions.map((fee) => fee.amount[0])

  const getFeeDetails = (feeDenom: string) => {
    const balance = balances.find((balance) => balance.denom === feeDenom)?.amount ?? 0
    const feeAmount = feeCoins.find((coin) => coin.denom === feeDenom)?.amount ?? 0
    const spendAmount = spendCoins
      .filter((coin) => coin.denom === feeDenom)
      .reduce((total, coin) => BigNumber(total).plus(coin.amount), BigNumber(0))

    const { symbol, decimals } = findAsset(feeDenom)
    const formattedBalance = formatAmount(balance, { decimals })
    const formattedFee = formatAmount(feeAmount, { decimals })
    const formattedSpend = spendAmount.gt(0)
      ? formatAmount(spendAmount.toFixed(), { decimals })
      : null

    const totalRequired = BigNumber(feeAmount).plus(spendAmount)
    const formattedTotal = formatAmount(totalRequired.toFixed(), { decimals })
    const isSufficient = BigNumber(balance).gte(totalRequired)

    return {
      symbol,
      formattedSpend,
      formattedFee,
      formattedTotal,
      formattedBalance,
      isSufficient,
    }
  }

  const getInitialFeeDenom = () => {
    if (lastUsedFeeDenom) {
      const details = getFeeDetails(lastUsedFeeDenom)
      if (details.isSufficient) {
        return lastUsedFeeDenom
      }
    }

    for (const { denom: feeDenom } of feeCoins) {
      const details = getFeeDetails(feeDenom)
      if (details.isSufficient) {
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
      if (!signer) throw new Error("Signer not initialized")
      const signedTx = await signWithEthSecp256k1(chainId, address, messages, fee, memo)
      await resolve(signedTx)
    },
    onError: async (error: Error) => {
      reject(error)
    },
  })

  const feeDetails = getFeeDetails(feeDenom)
  const { isSufficient } = feeDetails

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
          {!isSufficient && (
            <FormHelp level="error">
              <TxInsufficientBalance {...feeDetails} />
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
        <Button.White onClick={() => approve()} disabled={!isSufficient} loading={isPending}>
          Approve
        </Button.White>
      </Footer>
    </>
  )
}

export default TxRequest
