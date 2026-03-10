import type { TxJson } from "@skip-go/client"
import { useQuery } from "@tanstack/react-query"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import { normalizeError } from "@/data/http"
import { useAminoConverters, useAminoTypes, useCreateSigningStargateClient } from "@/data/signer"
import { useSkipBalancesQuery } from "./data/balance"
import { computeRequiredFeeByDenom, hasSufficientFeeBalance } from "./data/bridgeTxUtils"
import { useChainType, useSkipChain } from "./data/chains"
import { decodeCosmosAminoMessages, useBridgePreviewState } from "./data/tx"
import BridgePreviewFooter from "./BridgePreviewFooter"

import type { ReactNode } from "react"

interface Props {
  tx: TxJson
  children: ReactNode
}

function FooterWithExactFeeCheck({ tx, children }: Props) {
  const { route, values } = useBridgePreviewState()
  const { sender, recipient, srcChainId, srcDenom, dstChainId } = values
  const srcChain = useSkipChain(srcChainId)
  const dstChain = useSkipChain(dstChainId)
  const srcChainType = useChainType(srcChain)
  const dstChainType = useChainType(dstChain)
  const {
    data: balances,
    isLoading: isLoadingBalances,
    error: balancesError,
  } = useSkipBalancesQuery(sender, srcChainId)
  const aminoConverters = useAminoConverters()
  const aminoTypes = useAminoTypes()
  const createSigningStargateClient = useCreateSigningStargateClient()

  const requiresExactFeeCheck =
    "cosmos_tx" in tx &&
    !!tx.cosmos_tx.msgs?.length &&
    !route.required_op_hook &&
    srcChainType === "initia" &&
    dstChainType === "initia" &&
    !!sender &&
    !!recipient

  const {
    data: hasFeeBalance,
    error,
    isLoading,
  } = useQuery({
    queryKey: [
      "interwovenkit:bridge-preview-fee-check",
      tx,
      sender,
      srcChainId,
      srcDenom,
      route.amount_in,
    ],
    queryFn: async () => {
      try {
        if (!("cosmos_tx" in tx) || !tx.cosmos_tx.msgs?.length || !balances) {
          throw new Error("Invalid transaction data")
        }

        const messages = decodeCosmosAminoMessages(tx.cosmos_tx.msgs, {
          converters: aminoConverters,
          fromAmino: aminoTypes.fromAmino.bind(aminoTypes),
        })
        const client = await createSigningStargateClient(srcChainId)
        const gas = await client.simulate(sender, messages, "")
        const requiredFeeByDenom = computeRequiredFeeByDenom({
          gas,
          feeAssets: srcChain.fee_assets ?? [],
        })

        return hasSufficientFeeBalance({
          balances,
          requiredFeeByDenom,
          sourceDenom: srcDenom,
          amountIn: route.amount_in,
        })
      } catch (error) {
        throw await normalizeError(error)
      }
    },
    enabled: requiresExactFeeCheck && balances !== undefined,
    retry: false,
  })

  if (!requiresExactFeeCheck) {
    return children
  }

  if (balancesError) {
    return <BridgePreviewFooter tx={tx} error="Failed to load balances" />
  }

  if (isLoadingBalances || balances === undefined || isLoading) {
    return (
      <Footer>
        <Button.White loading="Checking fee balance..." />
      </Footer>
    )
  }

  if (error) {
    return <BridgePreviewFooter tx={tx} error={error.message} />
  }

  if (!hasFeeBalance) {
    return <BridgePreviewFooter tx={tx} error="Insufficient balance for fees" />
  }

  return children
}

export default FooterWithExactFeeCheck
