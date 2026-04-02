import type { TxJson } from "@skip-go/client"

export function getErc20ApprovalStateKey(tx: TxJson): string {
  if (!("evm_tx" in tx)) return "non-evm"

  return JSON.stringify({
    approvals: tx.evm_tx.required_erc20_approvals ?? [],
    chainId: tx.evm_tx.chain_id,
    signerAddress: tx.evm_tx.signer_address,
  })
}

export function shouldResetErc20ApprovalMutationState({
  currentKey,
  isPending,
  nextKey,
}: {
  currentKey: string
  isPending: boolean
  nextKey: string
}): boolean {
  return !isPending && currentKey !== nextKey
}
