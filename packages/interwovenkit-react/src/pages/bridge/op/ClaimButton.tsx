import { fromBase64, toBase64 } from "@cosmjs/encoding"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { IconCheckCircleFilled } from "@initia/icons-react"
import { useInitiaAddress, useInterwovenKit } from "@/public/data/hooks"
import { useLayer1 } from "@/data/chains"
import { computeWithdrawalHash, opQueryKeys, useOutputResponse, useWithdrawalClaimed } from "./data"
import { useOpWithdrawal } from "./context"
import styles from "./ClaimButton.module.css"

const ClaimButton = () => {
  const { withdrawalTx } = useOpWithdrawal()
  const {
    bridge_id,
    sequence,
    amount,
    output_index,
    withdrawal_proofs,
    storage_root,
    from,
    to,
    version,
  } = withdrawalTx

  const layer1 = useLayer1()
  const address = useInitiaAddress()
  const { requestTxSync, waitForTxConfirmation } = useInterwovenKit()
  const outputResponse = useOutputResponse(withdrawalTx)
  const withdrawalHash = toBase64(computeWithdrawalHash(withdrawalTx))
  const claimed = useWithdrawalClaimed(withdrawalTx, withdrawalHash)

  const queryClient = useQueryClient()
  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      if (!outputResponse) throw new Error("Output not found")
      const { last_block_hash } = outputResponse

      return requestTxSync({
        chainId: layer1.chain_id,
        messages: [
          {
            typeUrl: "/opinit.ophost.v1.MsgFinalizeTokenWithdrawal",
            value: {
              sender: address,
              bridgeId: BigInt(bridge_id),
              outputIndex: BigInt(output_index),
              withdrawalProofs: withdrawal_proofs.map(fromBase64),
              from: from,
              to: to,
              sequence: BigInt(sequence),
              amount: amount,
              version: fromBase64(version),
              storageRoot: fromBase64(storage_root),
              lastBlockHash: fromBase64(last_block_hash),
            },
          },
        ],
        internal: true,
      })
    },
    onSuccess: async (txHash) => {
      await waitForTxConfirmation({ chainId: layer1.chain_id, txHash })
      queryClient.invalidateQueries({
        queryKey: opQueryKeys.withdrawalClaimed(bridge_id, withdrawalHash).queryKey,
      })
    },
  })

  if (claimed) {
    return (
      <div className={styles.claimed}>
        <IconCheckCircleFilled size={14} />
        <span>Claimed</span>
      </div>
    )
  }

  return (
    <button className={styles.button} onClick={() => mutate()} disabled={isPending}>
      Claim
    </button>
  )
}

export default ClaimButton
