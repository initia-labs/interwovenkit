import { useAccount } from "wagmi"
import { useQuery } from "@tanstack/react-query"
import { useTx } from "@/data/tx"
import { useDrawer } from "@/data/ui"
import { useDefaultChain } from "@/data/chains"
import { useOfflineSigner } from "@/data/signer"
import { accountQueryKeys, useUsernameClient } from "@/data/account"
import type { FormValues } from "@/pages/bridge/data/form"
import { STALE_TIMES } from "@/data/http"
import { AddressUtils } from "../utils"

export function useInitiaAddress() {
  const hexAddress = useHexAddress()
  if (!hexAddress) return ""
  return AddressUtils.toBech32(hexAddress)
}

export function useHexAddress() {
  const { address } = useAccount()
  if (!address) return ""
  return AddressUtils.toPrefixedHex(address)
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

  const { openDrawer } = useDrawer()

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

  return {
    address,
    initiaAddress,
    hexAddress,
    username,
    offlineSigner,
    openConnect,
    openWallet,
    openBridge,
    ...tx,
  }
}
