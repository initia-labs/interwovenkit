import type { TxJson } from "@skip-go/client"
import { useQuery } from "@tanstack/react-query"
import { aminoConverters } from "@initia/amino-converter"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import { useAminoTypes, useCreateSigningStargateClient } from "@/data/signer"
import { useInitiaAddress } from "@/public/data/hooks"
import { useBridgePreviewState } from "../bridge/data/tx"

import type { ReactNode } from "react"

interface Props {
  tx: TxJson
  children: (gas: number | null) => ReactNode
}

const FooterWithTxFee = ({ tx, children }: Props) => {
  const { values } = useBridgePreviewState()
  const { srcChainId } = values
  const address = useInitiaAddress()
  const aminoTypes = useAminoTypes()
  const createSigningStargateClient = useCreateSigningStargateClient()

  const { data: gasEstimate, isLoading } = useQuery({
    queryKey: ["tx-gas-estimate", tx, address, srcChainId],
    queryFn: async () => {
      // Only simulate for cosmos transactions
      if (!("cosmos_tx" in tx)) return null
      if (!tx.cosmos_tx.msgs) return null

      try {
        // Parse the messages from the transaction
        const messages = tx.cosmos_tx.msgs.map(({ msg_type_url, msg }) => {
          if (!(msg_type_url && msg)) throw new Error("Invalid transaction data")
          // Note: `typeUrl` comes in proto format, but `msg` is in amino format.
          return aminoTypes.fromAmino({
            type: aminoConverters[msg_type_url].aminoType,
            value: JSON.parse(msg),
          })
        })

        // Use the same approach as estimateGas in tx.ts
        const client = await createSigningStargateClient(srcChainId)
        const gas = await client.simulate(address, messages, "")

        return {
          estimatedGas: gas,
          messages,
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("Failed to simulate gas:", error)
        return null
      }
    },
    enabled: !!tx && "cosmos_tx" in tx && !!address && !!srcChainId,
  })

  if (isLoading) {
    return (
      <Footer>
        <Button.White loading="Estimating gas..." />
      </Footer>
    )
  }

  // Pass the gas estimate to children (null if not a cosmos tx or if estimation failed)
  const gas = gasEstimate?.estimatedGas ?? null
  return <>{children(gas)}</>
}

export default FooterWithTxFee
