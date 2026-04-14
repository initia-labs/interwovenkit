import type { TxJson } from "@skip-go/client"
import { ethers } from "ethers"
import { cloneElement, isValidElement, useEffect, useRef } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import FormHelp from "@/components/form/FormHelp"
import { normalizeError } from "@/data/http"
import { useGetProvider } from "@/data/signer"
import { TimeoutError, withTimeout } from "@/lib/promise"
import { useFindSkipChain } from "./data/chains"
import { switchEthereumChain } from "./data/evm"
import { getBridgeErc20ApprovalsQueryKey, useBridgeErc20ApprovalsQuery } from "./data/preparation"
import {
  getErc20ApprovalStateKey,
  shouldResetErc20ApprovalMutationState,
} from "./footerWithErc20ApprovalState"

import type { ReactNode } from "react"

interface Props {
  tx: TxJson
  children: ReactNode | ((status: Erc20ApprovalStatus) => ReactNode)
}

interface Erc20ApprovalStatus {
  approvalError?: string
  approveTokens?: () => void
  isApproving: boolean
  isCheckingApprovals: boolean
  requiresApproval: boolean
}

function renderFooterWithErc20ApprovalChildren(
  children: ReactNode | ((status: Erc20ApprovalStatus) => ReactNode),
  status: Erc20ApprovalStatus,
) {
  if (typeof children === "function") {
    return children(status)
  }

  if (status.isCheckingApprovals) {
    return (
      <Footer>
        <Button.White loading="Checking approvals..." />
      </Footer>
    )
  }

  if (status.requiresApproval && status.approveTokens) {
    return (
      <Footer extra={<FormHelp level="error">{status.approvalError}</FormHelp>}>
        <Button.White
          onClick={status.approveTokens}
          loading={status.isApproving && "Approving tokens..."}
        >
          Approve tokens
        </Button.White>
      </Footer>
    )
  }

  if (status.approvalError && isValidElement<{ error?: string }>(children)) {
    return cloneElement(children, { error: status.approvalError })
  }

  return children
}

const FooterWithErc20Approval = ({ tx, children }: Props) => {
  const getProvider = useGetProvider()
  const findSkipChain = useFindSkipChain()
  const queryClient = useQueryClient()
  const approvalStateKey = getErc20ApprovalStateKey(tx)
  const previousApprovalStateKeyRef = useRef(approvalStateKey)
  const approvalChainRpc = "evm_tx" in tx ? findSkipChain(tx.evm_tx.chain_id).rpc : undefined

  const {
    data: approvalsNeeded,
    error: approvalCheckError,
    isLoading,
  } = useBridgeErc20ApprovalsQuery(tx)

  const { mutate, data, isPending, error, reset } = useMutation({
    mutationFn: async () => {
      try {
        if (!("evm_tx" in tx)) throw new Error("Transaction is not EVM")
        if (!approvalsNeeded || approvalsNeeded.length === 0) throw new Error("No approvals needed")

        const { chain_id: chainId } = tx.evm_tx
        const provider = await getProvider()
        const signer = await provider.getSigner()
        await switchEthereumChain(provider, findSkipChain(chainId))

        for (const approval of approvalsNeeded) {
          const { token_contract, spender, amount } = approval
          const erc20Abi = [
            "function approve(address spender, uint256 amount) external returns (bool)",
          ]
          const tokenContract = new ethers.Contract(token_contract, erc20Abi, signer)
          const response = await tokenContract.approve(spender, amount)
          // Same timeout as bridge tx — ethers' wait() has no built-in
          // timeout. If the tx is dropped without replacement, it hangs.
          await withTimeout(
            response.wait(),
            30_000,
            "Approval was not confirmed in time. It may still be processing.",
          )
        }

        return true
      } catch (error) {
        if (error instanceof TimeoutError) {
          // The approval tx may have confirmed on-chain after the timeout.
          // Refetch allowances so the button state reflects actual on-chain data
          // and the user doesn't pay gas for a redundant second approval.
          queryClient.invalidateQueries({
            queryKey: [...getBridgeErc20ApprovalsQueryKey(tx), approvalChainRpc],
          })
          throw error
        }
        throw await normalizeError(error)
      }
    },
  })

  useEffect(() => {
    const currentKey = previousApprovalStateKeyRef.current

    if (
      !shouldResetErc20ApprovalMutationState({
        currentKey,
        isPending,
        nextKey: approvalStateKey,
      })
    ) {
      return
    }

    previousApprovalStateKeyRef.current = approvalStateKey
    reset()
  }, [approvalStateKey, isPending, reset])

  return renderFooterWithErc20ApprovalChildren(children, {
    approvalError: error?.message ?? approvalCheckError?.message,
    approveTokens:
      approvalsNeeded && approvalsNeeded.length > 0 && !data ? () => mutate() : undefined,
    isApproving: isPending,
    isCheckingApprovals: isLoading,
    requiresApproval: !!approvalsNeeded && approvalsNeeded.length > 0 && !data,
  })
}

export default FooterWithErc20Approval
