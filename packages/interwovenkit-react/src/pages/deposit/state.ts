import { InitiaAddress } from "@initia/utils"
import type { RouterRouteResponseJson } from "../bridge/data/simulate"

export interface TransferLocationState {
  route?: RouterRouteResponseJson
  quoteVerifiedAt?: number
  recipientAddress?: string
  values?: object
  [key: string]: unknown
}

interface BuildTransferLocationStateArgs<T extends object> {
  currentState: TransferLocationState
  route: RouterRouteResponseJson | undefined
  quoteVerifiedAt?: number
  hexAddress: string
  values: T
}

export function getTransferRecipient(recipientAddress: string | undefined, hexAddress: string) {
  return recipientAddress ? InitiaAddress(recipientAddress).hex : hexAddress
}

export function buildTransferLocationState<T extends object>({
  currentState,
  route,
  quoteVerifiedAt,
  hexAddress,
  values,
}: BuildTransferLocationStateArgs<T>) {
  return {
    ...currentState,
    route,
    quoteVerifiedAt,
    values: {
      sender: hexAddress,
      recipient: getTransferRecipient(currentState.recipientAddress, hexAddress),
      slippagePercent: "1",
      ...values,
    },
  }
}
