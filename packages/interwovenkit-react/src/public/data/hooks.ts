import { useAccount } from "wagmi"
import { useQuery } from "@tanstack/react-query"
import { InitiaAddress } from "@initia/utils"
import { accountQueryKeys, useUsernameClient } from "@/data/account"
import { useDefaultChain } from "@/data/chains"
import { useOpenDeposit, useOpenWithdraw } from "@/data/deposit"
import { STALE_TIMES } from "@/data/http"
import { useOfflineSigner } from "@/data/signer"
import { useTx } from "@/data/tx"
import { useDisconnect, useDrawer, useModal } from "@/data/ui"
import { useAutoSign } from "@/pages/autosign/data/public"
import type { FormValues } from "@/pages/bridge/data/form"

export { usePortfolio } from "@/data/portfolio"

export function useInitiaAddress() {
  const hexAddress = useHexAddress()
  if (!hexAddress) return ""
  return InitiaAddress(hexAddress).bech32
}

export function useHexAddress() {
  const { address } = useAccount()
  if (!address) return ""
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

export function useUsernameQuery(address?: string) {
  const connectedAddress = useAddress()
  const targetAddress = address ?? connectedAddress
  const client = useUsernameClient()
  return useQuery({
    queryKey: accountQueryKeys.username(client.restUrl, targetAddress).queryKey,
    queryFn: () => client.getUsername(targetAddress),
    enabled: !!targetAddress,
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
  const { isModalOpen } = useModal()

  const openWallet = () => {
    openDrawer("/")
  }

  const openConnect = () => {
    openDrawer("/connect")
  }

  const openBridge = (defaultValues?: Partial<FormValues>) => {
    openDrawer("/bridge", defaultValues)
  }

  const openDeposit = useOpenDeposit()
  const openWithdraw = useOpenWithdraw()
  const tx = useTx()

  const isConnected = !!address
  const isOpen = isDrawerOpen || isModalOpen

  return {
    address,
    initiaAddress,
    hexAddress,
    username,
    offlineSigner,
    isConnected,
    isOpen,
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
