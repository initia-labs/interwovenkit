import type { AssetOption } from "@/pages/deposit/hooks"
import { useAddress } from "@/public/data/hooks"
import { useDefaultChain } from "./chains"
import { useModal } from "./ui"

export function useOpenDeposit() {
  const address = useAddress()
  const defaultChain = useDefaultChain()
  const { openModal } = useModal()

  return (params: {
    denoms: string[]
    chainId?: string
    srcOptions?: AssetOption[]
    recipientAddress?: string
  }) => {
    if (!address) {
      throw new Error("No wallet connected")
    }
    const { denoms, chainId, srcOptions, recipientAddress } = params
    if (denoms.length === 0) {
      throw new Error("denoms cannot be empty")
    }
    const targetChainId = chainId ?? defaultChain.chainId
    const localOptions: AssetOption[] = denoms.map((denom) => ({
      denom,
      chainId: targetChainId,
    }))
    openModal("/deposit", { localOptions, remoteOptions: srcOptions, recipientAddress })
  }
}

export function useOpenWithdraw() {
  const address = useAddress()
  const defaultChain = useDefaultChain()
  const { openModal } = useModal()

  return (params: {
    denoms: string[]
    chainId?: string
    dstOptions?: AssetOption[]
    recipientAddress?: string
  }) => {
    if (!address) {
      throw new Error("No wallet connected")
    }
    const { denoms, chainId, dstOptions, recipientAddress } = params
    if (denoms.length === 0) {
      throw new Error("denoms cannot be empty")
    }
    const targetChainId = chainId ?? defaultChain.chainId
    const localOptions: AssetOption[] = denoms.map((denom) => ({
      denom,
      chainId: targetChainId,
    }))
    openModal("/withdraw", { localOptions, remoteOptions: dstOptions, recipientAddress })
  }
}
