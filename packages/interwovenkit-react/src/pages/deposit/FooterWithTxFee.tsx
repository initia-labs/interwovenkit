import type { EncodeObject } from "@cosmjs/proto-signing"
import type { TxJson } from "@skip-go/client"
import { useQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import { useConfig } from "@/data/config"
import { patchedAminoConverters } from "@/data/patches/amino"
import { useAminoTypes, useCreateSigningStargateClient } from "@/data/signer"
import { useInitiaAddress } from "@/public/data/hooks"
import { useBridgePreviewState } from "../bridge/data/tx"

import type { ReactNode } from "react"

const queryKeys = createQueryKeys("interwovenkit:tx-gas-estimate", {
  estimate: (params: { tx: TxJson; address: string; chainId: string }) => [params],
})

interface Props {
  tx: TxJson
  children: (gas: number | null, status: { isEstimatingGas: boolean }) => ReactNode
}

function decodeCosmosAminoMessages(
  msgs: Array<{ msg_type_url?: string; msg?: string }> | undefined,
  options: {
    fromAmino: (value: { type: string; value: unknown }) => EncodeObject
    converters: Record<string, { aminoType: string }>
  },
): EncodeObject[] {
  if (!msgs?.length) throw new Error("Invalid transaction data")

  return msgs.map(({ msg_type_url, msg }) => {
    if (!(msg_type_url && msg)) throw new Error("Invalid transaction data")

    const converter = options.converters[msg_type_url]
    if (!converter) throw new Error(`Unsupported message type: ${msg_type_url}`)

    return options.fromAmino({
      type: converter.aminoType,
      value: JSON.parse(msg),
    })
  })
}

const FooterWithTxFee = ({ tx, children }: Props) => {
  const { values } = useBridgePreviewState()
  const { srcChainId } = values
  const address = useInitiaAddress()
  const config = useConfig()
  const aminoConverters = { ...patchedAminoConverters, ...config.aminoConverters }
  const aminoTypes = useAminoTypes()
  const createSigningStargateClient = useCreateSigningStargateClient()

  const {
    data: gasEstimate,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: queryKeys.estimate({ tx, address, chainId: srcChainId }).queryKey,
    queryFn: async () => {
      // Only simulate for cosmos transactions
      if (!("cosmos_tx" in tx)) return null
      if (!tx.cosmos_tx.msgs) return null

      try {
        const messages = decodeCosmosAminoMessages(tx.cosmos_tx.msgs, {
          converters: aminoConverters,
          fromAmino: aminoTypes.fromAmino.bind(aminoTypes),
        })

        // Use the same approach as estimateGas in tx.ts
        const client = await createSigningStargateClient(srcChainId)
        const gas = await client.simulate(address, messages, "")

        return {
          estimatedGas: gas,
          messages,
        }
      } catch {
        return null
      }
    },
    enabled: !!tx && "cosmos_tx" in tx && !!address && !!srcChainId,
  })

  // Show loading state until gas estimation completes to prevent layout shift
  const gas = gasEstimate?.estimatedGas ?? null
  const isEstimatingGas = "cosmos_tx" in tx && (isLoading || isFetching)

  if (isLoading) {
    return (
      <Footer>
        <Button.White loading="Estimating gas..." disabled fullWidth />
      </Footer>
    )
  }

  return <>{children(gas, { isEstimatingGas })}</>
}

export default FooterWithTxFee
