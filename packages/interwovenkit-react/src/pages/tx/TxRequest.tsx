import { calculateFee, GasPrice } from "@cosmjs/stargate"
import BigNumber from "bignumber.js"
import { sentenceCase } from "change-case"
import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { IconClose } from "@initia/icons-react"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import FormHelp from "@/components/form/FormHelp"
import Scrollable from "@/components/Scrollable"
import WidgetAccordion from "@/components/WidgetAccordion"
import { useBalances } from "@/data/account"
import { useFindAsset } from "@/data/assets"
import { useChain } from "@/data/chains"
import { getFeeDetails, useGasPrices, useLastFeeDenom } from "@/data/fee"
import { useSignWithEthSecp256k1 } from "@/data/signer"
import { TX_APPROVAL_MUTATION_KEY, useTxRequestHandler } from "@/data/tx"
import { useInitiaAddress } from "@/public/data/hooks"
import { useValidateAutoSign } from "../autosign/data/validation"
import { useSignWithEmbeddedWallet } from "../autosign/data/wallet"
import TxFee from "./TxFee"
import TxFeeInsufficient from "./TxFeeInsufficient"
import TxMessage from "./TxMessage"
import TxMeta from "./TxMeta"
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

  const getSpendAmount = (feeDenom: string) =>
    spendCoins
      .filter((coin) => coin.denom === feeDenom)
      .reduce((total, coin) => BigNumber(total).plus(coin.amount), BigNumber("0"))

  const calcFeeDetails = (feeDenom: string) =>
    getFeeDetails({
      feeDenom,
      balances,
      feeOptions,
      spendAmount: getSpendAmount(feeDenom),
      findAsset,
    })

  const getInitialFeeDenom = () => {
    if (lastUsedFeeDenom && calcFeeDetails(lastUsedFeeDenom).isSufficient) {
      return lastUsedFeeDenom
    }

    const feeCoins = feeOptions.map((fee) => fee.amount[0])
    for (const { denom: feeDenom } of feeCoins) {
      if (calcFeeDetails(feeDenom).isSufficient) {
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

  const feeDetails = calcFeeDetails(feeDenom)
  const isInsufficient = !feeDetails.isSufficient

  return (
    <>
      <Scrollable>
        <h1 className={styles.title}>Confirm tx</h1>

        <div className={styles.meta}>
          <TxMeta.Item title="Chain" content={chainId} />
          <TxMeta.Item
            title="Tx fee"
            content={
              <TxFee chain={chain} options={feeOptions} value={feeDenom} onChange={setFeeDenom} />
            }
          />
          {memo && <TxMeta.Item title="Memo" content={memo} />}
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
        <Button.Outline
          onClick={() => reject(new Error("User rejected"))}
          disabled={isPending}
          className={styles.rejectButton}
        >
          <IconClose size={16} />
        </Button.Outline>
        <Button.White onClick={() => approve()} disabled={isInsufficient} loading={isPending}>
          Approve
        </Button.White>
      </Footer>
    </>
  )
}

export default TxRequest
