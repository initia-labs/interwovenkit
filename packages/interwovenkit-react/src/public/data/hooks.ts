import type { ComponentType } from "react"
import { useAccount } from "wagmi"
import { useQuery } from "@tanstack/react-query"
import { InitiaAddress } from "@initia/utils"
import { useTx } from "@/data/tx"
import { useDisconnect, useDrawer } from "@/data/ui"
import { useDefaultChain } from "@/data/chains"
import { useOfflineSigner } from "@/data/signer"
import { accountQueryKeys, useUsernameClient } from "@/data/account"
import type { FormValues } from "@/pages/bridge/data/form"
import { STALE_TIMES } from "@/data/http"

export { usePortfolio } from "@/data/portfolio"

export function useDrawerControl() {
  const { openDrawer, closeDrawer } = useDrawer()

  return {
    openDrawer: (component?: ComponentType) => openDrawer("/custom", undefined, component),
    closeDrawer,
  }
}

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

  const { isDrawerOpen: isOpen, openDrawer } = useDrawer()

  const openWallet = () => {
    openDrawer("/")
  }

  const openConnect = () => {
    openDrawer("/connect")
  }

  const openBridge = (defaultValues?: Partial<FormValues>) => {
    openDrawer("/bridge", defaultValues)
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
    isOpen,
    openConnect,
    openWallet,
    openBridge,
    disconnect,
    ...tx,
  }
}
