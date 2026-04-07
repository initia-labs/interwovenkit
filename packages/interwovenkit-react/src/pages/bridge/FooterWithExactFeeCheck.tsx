import type { TxJson } from "@skip-go/client"
import { useQuery } from "@tanstack/react-query"
import { useFindChain } from "@/data/chains"
import { fetchGasPrices } from "@/data/fee"
import { normalizeError } from "@/data/http"
import { useAminoConverters, useAminoTypes, useCreateSigningStargateClient } from "@/data/signer"
import { useSkipBalancesQuery } from "./data/balance"
import { computeRequiredFeeByDenom, hasSufficientFeeBalance } from "./data/bridgeTxUtils"
import { useChainType, useSkipChain } from "./data/chains"
import { getExactFeeCheckSetup } from "./data/exactFeeCheck"
import { decodeCosmosAminoMessages, useBridgePreviewState } from "./data/tx"

import type { ReactNode } from "react"

interface Props {
  tx: TxJson
  children: (status: { exactFeeCheckError?: string; isCheckingFeeBalance: boolean }) => ReactNode
}

function FooterWithExactFeeCheck({ tx, children }: Props) {
  const { route, values } = useBridgePreviewState()
  const { sender, recipient, srcChainId, srcDenom, dstChainId } = values
  const findChain = useFindChain()
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
  const exactFeeCheck = getExactFeeCheckSetup({
    balances,
    dstChainType,
    findChain,
    recipient,
    route,
    sender,
    srcChainId,
    srcChainType,
    srcDenom,
    tx,
  })

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
      exactFeeCheck?.balanceKey,
    ],
    queryFn: async () => {
      try {
        if (!(exactFeeCheck && "cosmos_tx" in tx && tx.cosmos_tx.msgs?.length && balances)) {
          throw new Error("Invalid transaction data")
        }

        const messages = decodeCosmosAminoMessages(tx.cosmos_tx.msgs, {
          converters: aminoConverters,
          fromAmino: aminoTypes.fromAmino.bind(aminoTypes),
        })
        const client = await createSigningStargateClient(srcChainId)
        const gas = await client.simulate(sender, messages, "")
        const gasPrices = await fetchGasPrices(findChain(srcChainId))
        const requiredFeeByDenom = computeRequiredFeeByDenom({
          gas,
          gasPrices,
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
    enabled: !!exactFeeCheck && balances !== undefined,
    retry: false,
  })

  if (!exactFeeCheck) {
    return children({ isCheckingFeeBalance: false })
  }

  if (balancesError) {
    return children({
      exactFeeCheckError: "Failed to load balances",
      isCheckingFeeBalance: false,
    })
  }

  if (isLoadingBalances || balances === undefined || isLoading) {
    return children({ isCheckingFeeBalance: true })
  }

  if (error) {
    return children({ exactFeeCheckError: error.message, isCheckingFeeBalance: false })
  }

  if (!hasFeeBalance) {
    return children({
      exactFeeCheckError: "Insufficient balance for fees",
      isCheckingFeeBalance: false,
    })
  }

  return children({ isCheckingFeeBalance: false })
}

export default FooterWithExactFeeCheck
