import type { TxJson } from "@skip-go/client"
import { useQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import { useAminoConverters, useAminoTypes, useCreateSigningStargateClient } from "@/data/signer"
import { decodeCosmosAminoMessages, useBridgePreviewState } from "@/pages/bridge/data/tx"
import { useInitiaAddress } from "@/public/data/hooks"

import type { ReactNode } from "react"

const queryKeys = createQueryKeys("interwovenkit:tx-gas-estimate", {
  estimate: (params: { tx: TxJson; address: string; chainId: string }) => [params],
})

interface Props {
  tx: TxJson
  children: (gas: number | null, status: { isEstimatingGas: boolean }) => ReactNode
}

const FooterWithTxFee = ({ tx, children }: Props) => {
  const { values } = useBridgePreviewState()
  const { srcChainId } = values
  const address = useInitiaAddress()
  const aminoConverters = useAminoConverters()
  const aminoTypes = useAminoTypes()
  const createSigningStargateClient = useCreateSigningStargateClient()

  const {
    data: gasEstimate,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: queryKeys.estimate({ tx, address, chainId: srcChainId }).queryKey,
    queryFn: async () => {
      if (!("cosmos_tx" in tx)) return null
      if (!tx.cosmos_tx.msgs) return null

      try {
        const messages = decodeCosmosAminoMessages(tx.cosmos_tx.msgs, {
          converters: aminoConverters,
          fromAmino: aminoTypes.fromAmino.bind(aminoTypes),
        })

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

  // Block render only for initial cosmos gas estimation; background refetches pass through.
  if ("cosmos_tx" in tx && !gasEstimate && isLoading) {
    return (
      <Footer>
        <Button.White loading="Estimating gas..." disabled fullWidth />
      </Footer>
    )
  }

  const gas = gasEstimate?.estimatedGas ?? null
  const isEstimatingGas = "cosmos_tx" in tx && (isLoading || isFetching)
  return <>{children(gas, { isEstimatingGas })}</>
}

export default FooterWithTxFee
