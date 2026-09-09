import type { AssetOption, OnrampPreset } from "@/pages/deposit/data/assetOptions"
import { usePrefetchDepositAssets } from "@/pages/deposit/data/assets"
import { useAddress } from "@/public/data/hooks"
import { useDefaultChain } from "./chains"
import { useModal } from "./ui"

export function normalizeOnrampPreset(onramp: OnrampPreset): OnrampPreset {
  if (typeof onramp.amount !== "string" || typeof onramp.currency !== "string") {
    throw new Error("onramp amount and currency must be strings")
  }

  const amount = onramp.amount.trim()
  const currency = onramp.currency.trim().toLowerCase()
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) {
    throw new Error("onramp amount must be a non-negative decimal with at most 2 decimal places")
  }
  if (!/^[a-z]{3}$/.test(currency)) {
    throw new Error("onramp currency must be a 3-letter ISO code")
  }

  return { amount, currency }
}

export function useOpenDeposit() {
  const address = useAddress()
  const defaultChain = useDefaultChain()
  const { openModal } = useModal()
  const prefetchDepositAssets = usePrefetchDepositAssets()

  return (params: {
    denoms: string[]
    chainId?: string
    srcOptions?: AssetOption[]
    recipientAddress?: string
    onramp?: OnrampPreset
  }) => {
    if (!address) {
      throw new Error("No wallet connected")
    }
    const { denoms, chainId, srcOptions, recipientAddress, onramp } = params
    if (denoms.length === 0) {
      throw new Error("denoms cannot be empty")
    }
    const normalizedOnramp = onramp ? normalizeOnrampPreset(onramp) : undefined
    // Start the Deposit API route fetch alongside the modal so the method hub
    // arrives with availability resolved (see usePrefetchDepositAssets).
    prefetchDepositAssets()
    const targetChainId = chainId ?? defaultChain.chainId
    const localOptions: AssetOption[] = denoms.map((denom) => ({
      denom,
      chainId: targetChainId,
    }))
    openModal("/deposit", {
      localOptions,
      remoteOptions: srcOptions,
      recipientAddress,
      onramp: normalizedOnramp,
    })
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
