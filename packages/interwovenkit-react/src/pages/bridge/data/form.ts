import { pickBy } from "ramda"
import { useFormContext } from "react-hook-form"
import { useLocationState } from "@/lib/router"
import { LocalStorageKey } from "@/data/constants"
import { useLayer1 } from "@/data/chains"

export function useIsTestnet() {
  const chain = useLayer1()
  return chain.network_type === "testnet"
}

export interface FormValues {
  srcChainId: string
  srcDenom: string
  dstChainId: string
  dstDenom: string
  quantity: string
  sender: string
  cosmosWalletName?: string
  recipient: string
  slippagePercent: string
}

export function useBridgeForm() {
  return useFormContext<FormValues>()
}

export function useDefaultValues(): Partial<FormValues> {
  const stateDefaultValues = useLocationState<Partial<FormValues>>()

  const isTestnet = useIsTestnet()

  const baseDefaultValues: Partial<FormValues> = {
    quantity: "",
    slippagePercent: "0.5",
    sender: "",
    cosmosWalletName: "",
    recipient: "",
  }

  const testnetDefaultValues: Partial<FormValues> = {
    ...baseDefaultValues,
    srcChainId: "initiation-2",
    srcDenom: "uusdc",
    dstChainId: "initiation-2",
    dstDenom: "uinit",
  }

  const mainnetDefaultValues: Partial<FormValues> = {
    ...baseDefaultValues,
    srcChainId: "interwoven-1",
    srcDenom: "ibc/6490A7EAB61059BFC1CDDEB05917DD70BDF3A611654162A1A47DB930D40D8AF4",
    dstChainId: "interwoven-1",
    dstDenom: "uinit",
  }

  const localStorageDefaultValues: Partial<FormValues> = pickBy((value) => value !== null, {
    srcChainId: localStorage.getItem(LocalStorageKey.BRIDGE_SRC_CHAIN_ID),
    srcDenom: localStorage.getItem(LocalStorageKey.BRIDGE_SRC_DENOM),
    dstChainId: localStorage.getItem(LocalStorageKey.BRIDGE_DST_CHAIN_ID),
    dstDenom: localStorage.getItem(LocalStorageKey.BRIDGE_DST_DENOM),
    quantity: localStorage.getItem(LocalStorageKey.BRIDGE_QUANTITY),
    slippagePercent: localStorage.getItem(LocalStorageKey.BRIDGE_SLIPPAGE_PERCENT),
  })

  return {
    ...(isTestnet ? testnetDefaultValues : mainnetDefaultValues),
    ...localStorageDefaultValues,
    ...stateDefaultValues,
  }
}
