import { useAccount } from "wagmi"
import { useAtomValue } from "jotai"
import { useQuery } from "@tanstack/react-query"
import { InitiaAddress } from "@initia/utils"
import { accountQueryKeys, useUsernameClient } from "@/data/account"
import { useDefaultChain } from "@/data/chains"
import { useConfig } from "@/data/config"
import { useSetGhostWalletRequestHandler } from "@/data/ghost-wallet"
import { STALE_TIMES } from "@/data/http"
import { useOfflineSigner } from "@/data/signer"
import { useTx } from "@/data/tx"
import { useDisconnect, useDrawer } from "@/data/ui"
import type { FormValues } from "@/pages/bridge/data/form"
import {
  ghostWalletLoadingAtom,
  useAutoSignPermissions,
  useGhostWalletState,
  useRevokeAutoSign,
} from "@/pages/ghost-wallet/hooks"

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
  const config = useConfig()
  const autoSignPermissions = useAutoSignPermissions()
  const address = useAddress()
  const initiaAddress = useInitiaAddress()
  const hexAddress = useHexAddress()
  const { data: username } = useUsernameQuery()
  const offlineSigner = useOfflineSigner()
  const disconnect = useDisconnect()
  const ghostWalletState = useGhostWalletState()
  const ghostWalletLoading = useAtomValue(ghostWalletLoadingAtom)
  const revokeAutoSign = useRevokeAutoSign()

  const { isDrawerOpen: isOpen, openDrawer } = useDrawer()

  const openWallet = () => {
    openDrawer("/")
  }

  const openConnect = () => {
    if (config.privy) {
      config.privy.login()
    } else {
      openDrawer("/connect")
    }
  }

  const openBridge = (defaultValues?: Partial<FormValues>) => {
    openDrawer("/bridge", defaultValues)
  }

  const setGhostWalletRequestHandler = useSetGhostWalletRequestHandler()

  const setupAutoSign = async (chainId: string): Promise<void> => {
    if (!autoSignPermissions?.[chainId]?.length)
      throw new Error("Auto sign permissions are required for the setup")

    if (ghostWalletState.isEnabled[chainId]) throw new Error("Auto sign is already enabled")

    return new Promise<void>((resolve, reject) => {
      setGhostWalletRequestHandler({
        resolve,
        reject,
      })

      openDrawer("/ghost-wallet", { chainId })
    })
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
    autoSign: {
      expirationTimes: ghostWalletState.expirations,
      isEnabled: ghostWalletState.isEnabled,
      setup: setupAutoSign,
      revoke: revokeAutoSign,
      isLoading: ghostWalletLoading,
    },
    ...tx,
  }
}
