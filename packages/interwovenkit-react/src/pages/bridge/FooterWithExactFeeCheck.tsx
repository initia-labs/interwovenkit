import type { TxJson } from "@skip-go/client"
import { useQuery } from "@tanstack/react-query"
import { useChainEnabled } from "@/data/chains"
import { fetchGasPrices } from "@/data/fee"
import { normalizeError } from "@/data/http"
import { useAminoConverters, useAminoTypes, useCreateSigningStargateClient } from "@/data/signer"
import { useSkipBalancesQuery } from "./data/balance"
import { computeRequiredFeeByDenom, hasSufficientFeeBalance } from "./data/bridgeTxUtils"
import { useChainType, useSkipChain } from "./data/chains"
import { shouldCheckExactFee, shouldRunExactFeeQuery } from "./data/exactFeeCheck"
import { decodeCosmosAminoMessages, useBridgePreviewState } from "./data/tx"

import type { ReactNode } from "react"

interface Props {
  tx: TxJson
  children: (status: { exactFeeCheckError?: string; isCheckingFeeBalance: boolean }) => ReactNode
}

function getFeeBalanceKey({
  balances,
  feeDenoms,
}: {
  balances?: Record<string, { amount?: string }>
  feeDenoms: string[]
}): string {
  if (!balances) return ""

  return feeDenoms
    .toSorted()
    .map((denom) => `${denom}:${balances[denom]?.amount ?? "0"}`)
    .join("|")
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
  const requiresExactFeeCheck = shouldCheckExactFee({
    route,
    tx,
    isSrcInitia: srcChainType === "initia",
    isDstInitia: dstChainType === "initia",
    sender,
    recipient,
  })
  const {
    chain,
    error: chainError,
    isLoading: isLoadingChain,
  } = useChainEnabled(srcChainId, requiresExactFeeCheck)
  const feeDenoms = chain
    ? Array.from(new Set([srcDenom, ...chain.fees.fee_tokens.map(({ denom }) => denom)]))
    : []
  const balanceKey = getFeeBalanceKey({ balances, feeDenoms })
  const shouldRunFeeQuery = shouldRunExactFeeQuery({
    hasBalances: balances !== undefined,
    hasChain: !!chain,
    requiresExactFeeCheck,
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
      balanceKey,
    ],
    queryFn: async () => {
      try {
        if (
          !(
            requiresExactFeeCheck &&
            chain &&
            "cosmos_tx" in tx &&
            tx.cosmos_tx.msgs?.length &&
            balances
          )
        ) {
          throw new Error("Invalid transaction data")
        }

        const messages = decodeCosmosAminoMessages(tx.cosmos_tx.msgs, {
          converters: aminoConverters,
          fromAmino: aminoTypes.fromAmino.bind(aminoTypes),
        })
        const client = await createSigningStargateClient(srcChainId)
        const gas = await client.simulate(sender, messages, "")
        const gasPrices = await fetchGasPrices(chain)
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
    enabled: shouldRunFeeQuery,
    retry: false,
  })

  if (!requiresExactFeeCheck) {
    return children({ isCheckingFeeBalance: false })
  }

  if (chainError) {
    return children({ exactFeeCheckError: chainError.message, isCheckingFeeBalance: false })
  }

  if (balancesError) {
    return children({
      exactFeeCheckError:
        balancesError instanceof Error ? balancesError.message : "Failed to load balances",
      isCheckingFeeBalance: false,
    })
  }

  if (isLoadingChain || isLoadingBalances || balances === undefined || isLoading) {
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
