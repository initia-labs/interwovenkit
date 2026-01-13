import { useAccount } from "wagmi"
import { useQuery } from "@tanstack/react-query"
import { InitiaAddress } from "@initia/utils"
import { accountQueryKeys, useUsernameClient } from "@/data/account"
import { useDefaultChain } from "@/data/chains"
import { STALE_TIMES } from "@/data/http"
import { useIsPrivyConnected } from "@/data/privy"
import { useOfflineSigner } from "@/data/signer"
import { useTx } from "@/data/tx"
import { useDisconnect, useDrawer, useModal } from "@/data/ui"
import { useAutoSign } from "@/pages/autosign/data/public"
import type { FormValues } from "@/pages/bridge/data/form"
import type { AssetOption } from "@/pages/deposit/hooks"

export { usePortfolio } from "@/data/portfolio"

export function useInitiaAddress() {
  const hexAddress = useHexAddress()
  if (!hexAddress) return ""
  return InitiaAddress(hexAddress).bech32
}

export function useHexAddress() {
  const { address } = useAccount()
  const isPrivyConnected = useIsPrivyConnected()
  // address undefined if privy is needed but not yet connected
  if (!address || !isPrivyConnected) return ""
  return InitiaAddress(address).hex
}

export function useAddress() {
  const defaultChain = useDefaultChain()
  const initiaAddress = useInitiaAddress()
  const hexAddress = useHexAddress()
  if (defaultChain.metadata?.minitia?.type === "minievm") {
    return hexAddress
  }
  return initiaAddress
}

export function useUsernameQuery() {
  const address = useAddress()
  const client = useUsernameClient()
  return useQuery({
    queryKey: accountQueryKeys.username(client.restUrl, address).queryKey,
    queryFn: () => client.getUsername(address),
    enabled: !!address,
    staleTime: STALE_TIMES.MINUTE,
  })
}

export function useInterwovenKit() {
  const address = useAddress()
  const initiaAddress = useInitiaAddress()
  const hexAddress = useHexAddress()
  const { data: username } = useUsernameQuery()
  const offlineSigner = useOfflineSigner()
  const disconnect = useDisconnect()
  const autoSign = useAutoSign()

  const { isDrawerOpen, openDrawer } = useDrawer()
  const { isModalOpen, openModal } = useModal()

  const openWallet = () => {
    openDrawer("/")
  }

  const openConnect = () => {
    openDrawer("/connect")
  }

  const openBridge = (defaultValues?: Partial<FormValues>) => {
    openDrawer("/bridge", defaultValues)
  }

  const openDeposit = (
    dstOptions: AssetOption[],
    options?: { srcOptions?: AssetOption[]; recipientAddress?: string },
  ) => {
    if (dstOptions.length === 0) {
      throw new Error("dstOptions cannot be empty")
    }
    openModal("/deposit", { dstOptions, ...options })
  }

  const openWithdraw = (
    dstOptions: AssetOption[],
    options?: { srcOptions?: AssetOption[]; recipientAddress?: string },
  ) => {
    if (dstOptions.length === 0) {
      throw new Error("dstOptions cannot be empty")
    }
    openModal("/withdraw", { dstOptions, ...options })
  }

  const tx = useTx()

  const isConnected = !!address

  return {
    address,
    initiaAddress,
    hexAddress,
    username,
    offlineSigner,
    isConnected,
    isOpen: isDrawerOpen || isModalOpen,
    openConnect,
    openWallet,
    openBridge,
    openDeposit,
    openWithdraw,
    disconnect,
    autoSign,
    ...tx,
  }
}
