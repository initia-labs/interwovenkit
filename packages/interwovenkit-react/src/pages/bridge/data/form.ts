import { pickBy } from "ramda"
import { useFormContext } from "react-hook-form"
import { useLayer1 } from "@/data/chains"
import { LocalStorageKey } from "@/data/constants"
import { parseQuantity } from "@/lib/amountValidation"
import { useLocationState } from "@/lib/router"

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

// Earlier builds let SlippageControl persist mid-input values like "" or "."
// into localStorage. Replaying those would either throw under BigNumber strict
// mode or sign with no slippage protection. Accept only finite positives.
export function normalizePersistedSlippage(persisted: string | null): string | null {
  const slippageBn = parseQuantity(persisted)
  return slippageBn && slippageBn.gt(0) ? persisted : null
}

interface PersistedRecipient {
  address: string
  recipient: string
}

export function getPersistedRecipient(persisted: string | null, address?: string): string | null {
  if (!persisted || !address) return null

  try {
    const parsed = JSON.parse(persisted) as Partial<PersistedRecipient>
    if (parsed.address?.toLowerCase() !== address.toLowerCase()) return null
    return typeof parsed.recipient === "string" ? parsed.recipient : null
  } catch {
    return null
  }
}

export function createPersistedRecipient(address: string, recipient: string) {
  return JSON.stringify({ address, recipient } satisfies PersistedRecipient)
}

export function useDefaultValues(address?: string): Partial<FormValues> {
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
    slippagePercent: normalizePersistedSlippage(
      localStorage.getItem(LocalStorageKey.BRIDGE_SLIPPAGE_PERCENT),
    ),
    recipient: getPersistedRecipient(
      localStorage.getItem(LocalStorageKey.BRIDGE_RECIPIENT),
      address,
    ),
  })

  return {
    ...(isTestnet ? testnetDefaultValues : mainnetDefaultValues),
    ...localStorageDefaultValues,
    ...stateDefaultValues,
  }
}
