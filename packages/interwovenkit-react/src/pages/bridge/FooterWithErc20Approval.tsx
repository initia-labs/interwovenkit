import { ethers } from "ethers"
import type { PropsWithChildren } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import type { TxJson } from "@skip-go/client"
import { normalizeError } from "@/data/http"
import { useGetProvider } from "@/data/signer"
import Footer from "@/components/Footer"
import FormHelp from "@/components/form/FormHelp"
import Button from "@/components/Button"
import { useFindSkipChain } from "./data/chains"
import { switchEthereumChain } from "./data/evm"

const FooterWithErc20Approval = ({ tx, children }: PropsWithChildren<{ tx: TxJson }>) => {
  const getProvider = useGetProvider()
  const findSkipChain = useFindSkipChain()

  const { data: approvalsNeeded, isLoading } = useQuery({
    queryKey: ["erc20-approvals-needed", tx],
    queryFn: async () => {
      if (!("evm_tx" in tx)) return []
      if (!tx.evm_tx.required_erc20_approvals) return []

      const { chain_id: chainId, signer_address } = tx.evm_tx
      const provider = await getProvider()
      await switchEthereumChain(provider, findSkipChain(chainId))

      const erc20Abi = ["function allowance(address owner, address spender) view returns (uint256)"]

      const approvalsWithAllowance = await Promise.all(
        tx.evm_tx.required_erc20_approvals.map(async (approval) => {
          const { token_contract, spender } = approval
          const tokenContract = new ethers.Contract(token_contract, erc20Abi, provider)
          const currentAllowance = await tokenContract.allowance(signer_address, spender)
          return { approval, currentAllowance: BigInt(currentAllowance.toString()) }
        }),
      )

      return approvalsWithAllowance
        .filter(({ approval, currentAllowance }) => currentAllowance < BigInt(approval.amount))
        .map(({ approval }) => approval)
    },
    enabled: !!tx && "evm_tx" in tx && !!tx.evm_tx.required_erc20_approvals,
  })

  const { mutate, data, isPending, error } = useMutation({
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
          await response.wait()
        }

        return true
      } catch (error) {
        throw await normalizeError(error)
      }
    },
  })

  if (isLoading) {
    return (
      <Footer>
        <Button.White loading="Checking approvals..." />
      </Footer>
    )
  }

  if (approvalsNeeded && approvalsNeeded.length > 0 && !data) {
    return (
      <Footer extra={<FormHelp level="error">{error?.message}</FormHelp>}>
        <Button.White onClick={() => mutate()} loading={isPending && "Approving tokens..."}>
          Approve tokens
        </Button.White>
      </Footer>
    )
  }

  return children
}

export default FooterWithErc20Approval
