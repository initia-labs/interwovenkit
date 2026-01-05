import type { TxJson } from "@skip-go/client"
import BigNumber from "bignumber.js"
import { useQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { toBaseUnit } from "@initia/utils"
import AsyncBoundary from "@/components/AsyncBoundary"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import FormHelp from "@/components/form/FormHelp"
import { useBalances } from "@/data/account"
import { useFindAsset } from "@/data/assets"
import { useFindChain } from "@/data/chains"
import { getFeeDetails, useTxFee } from "@/data/fee"
import TxFee from "@/pages/tx/TxFee"
import TxMeta from "@/pages/tx/TxMeta"
import { useInterwovenKit } from "@/public/data/hooks"
import { useFindSkipAsset } from "./data/assets"
import { useChainType, useSkipChain } from "./data/chains"
import { parseCosmosMessages, useBridgePreviewState, useBridgeTx } from "./data/tx"

const queryKeys = createQueryKeys("interwovenkit:bridge-fee", {
  gas: (params) => [params],
})

interface Props {
  tx: TxJson
}

const BridgePreviewFooterPlaceholder = () => {
  return (
    <Footer>
      <Button.White loading="Estimating gas..." />
    </Footer>
  )
}

const BridgePreviewFooterSimple = ({ tx }: Props) => {
  const { mutate, isPending } = useBridgeTx(tx)

  return (
    <Footer>
      <Button.White onClick={() => mutate()} loading={isPending && "Signing transaction..."}>
        Confirm
      </Button.White>
    </Footer>
  )
}

const BridgePreviewFooterWithFee = ({ tx }: Props) => {
  const { estimateGas, initiaAddress } = useInterwovenKit()
  const { values } = useBridgePreviewState()
  const { srcChainId, srcDenom, quantity } = values

  const findChain = useFindChain()
  const chain = findChain(srcChainId)
  const balances = useBalances(chain)
  const findAsset = useFindAsset(chain)
  const findSkipAsset = useFindSkipAsset(srcChainId)

  const messages = parseCosmosMessages(tx)

  const { data: estimatedGas = 0, isLoading } = useQuery({
    queryKey: queryKeys.gas({ chainId: srcChainId, sender: initiaAddress, tx }).queryKey,
    queryFn: () => estimateGas({ messages: parseCosmosMessages(tx), chainId: srcChainId }),
    enabled: messages.length > 0,
  })

  const { feeOptions, feeDenom, setFeeDenom, getFee } = useTxFee({ chain, estimatedGas })
  const fee = getFee()
  const { mutate, isPending } = useBridgeTx(tx, fee)

  const { decimals: srcDecimals } = findSkipAsset(srcDenom)
  const spendAmount = BigNumber(toBaseUnit(quantity, { decimals: srcDecimals }))

  const getSpendAmount = (selectedFeeDenom: string) =>
    srcDenom === selectedFeeDenom ? spendAmount : BigNumber(0)

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

  const feeExtra = (
    <FormHelp.Stack>
      {isInsufficient && <FormHelp level="error">Insufficient balance for fee</FormHelp>}
      <TxMeta>
        <TxMeta.Item
          title="Tx fee"
          content={
            <TxFee chain={chain} options={feeOptions} value={feeDenom} onChange={setFeeDenom} />
          }
        />
      </TxMeta>
    </FormHelp.Stack>
  )

  return (
    <Footer extra={feeExtra}>
      <Button.White
        onClick={() => mutate()}
        loading={
          (isLoading ? "Estimating gas..." : false) || (isPending && "Signing transaction...")
        }
        disabled={isInsufficient}
      >
        Confirm
      </Button.White>
    </Footer>
  )
}

const BridgePreviewFooter = ({ tx }: Props) => {
  const { values } = useBridgePreviewState()
  const { srcChainId } = values
  const srcSkipChain = useSkipChain(srcChainId)
  const srcChainType = useChainType(srcSkipChain)
  const isInitiaTx = "cosmos_tx" in tx && srcChainType === "initia"

  if (isInitiaTx) {
    return (
      <AsyncBoundary suspenseFallback={<BridgePreviewFooterPlaceholder />}>
        <BridgePreviewFooterWithFee tx={tx} />
      </AsyncBoundary>
    )
  }

  return <BridgePreviewFooterSimple tx={tx} />
}

export default BridgePreviewFooter
