import { fromBech32 } from "@cosmjs/encoding"
import { isAddress } from "ethers"
import { InitiaAddress } from "@initia/utils"
import { useInterwovenKit } from "@/public/data/hooks"
import { useFindChainType, useFindSkipChain } from "./chains"

function isBech32WithPrefix(address: string, prefix: string): boolean {
  try {
    return fromBech32(address).prefix === prefix
  } catch {
    return false
  }
}

export function useGetDefaultAddress() {
  const { initiaAddress, hexAddress } = useInterwovenKit()
  const findSkipChain = useFindSkipChain()
  const findChainType = useFindChainType()
  return (chainId: string) => {
    const chain = findSkipChain(chainId)
    const chainType = findChainType(chain)
    switch (chainType) {
      case "initia":
        // FIXME: If the field is a recipient address and the chain is based on MiniEVM,
        // it might be desirable to auto-fill the hex address.
        // However, since this address is also used as the sender, it's safer to use initiaAddress for now.
        return initiaAddress
      case "evm":
        return hexAddress
      default:
        return ""
    }
  }
}

export function useValidateAddress() {
  const findChain = useFindSkipChain()
  const findChainType = useFindChainType()

  return (address: string, chainId: string) => {
    const chain = findChain(chainId)
    const chainType = findChainType(chain)
    switch (chainType) {
      case "initia":
        // Strict bech32 check: the router API expects bech32 for initia chains,
        // so reject hex addresses even though InitiaAddress.validate() accepts both.
        return isBech32WithPrefix(address, chain.bech32_prefix ?? "init")
      case "evm":
        return isAddress(address)
      case "cosmos":
        return chain.bech32_prefix ? isBech32WithPrefix(address, chain.bech32_prefix) : false
      default:
        return false
    }
  }
}

export function useGetAddressForBalance() {
  const findChain = useFindSkipChain()
  const findChainType = useFindChainType()

  return ({
    initialAddress,
    initialChainId,
    chainId,
    fallbackAddress,
  }: {
    initialAddress: string
    initialChainId: string
    chainId: string
    fallbackAddress?: string
  }) => {
    const initialChain = findChain(initialChainId)
    const initialChainType = findChainType(initialChain)
    const chain = findChain(chainId)
    const chainType = findChainType(chain)
    if (initialChainType === "evm" && chainType === "initia") {
      return InitiaAddress(initialAddress).bech32
    }
    if (initialChainType === "initia" && chainType === "evm") {
      return InitiaAddress(initialAddress).hex
    }
    if (initialChainType === chainType) {
      return initialAddress
    }
    if (fallbackAddress) {
      if (chainType === "initia") return InitiaAddress(fallbackAddress).bech32
      if (chainType === "evm") return InitiaAddress(fallbackAddress).hex
    }
    return ""
  }
}
