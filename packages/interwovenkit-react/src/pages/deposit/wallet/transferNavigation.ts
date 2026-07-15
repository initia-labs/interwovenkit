import { InitiaAddress } from "@initia/utils"
import type { RouterRouteResponseJson } from "@/pages/bridge/data/simulate"
import type { TransferMode } from "./transferFlowConfig"

/**
 * The `values` snapshot carried in transfer location state.
 * `buildTransferLocationState` writes it, but the bridge preview flows overwrite
 * it with their own form values, so only the address fields the transfer flow
 * reads back are declared — optional, since a bridge-written snapshot carries no
 * guarantee about them.
 */
export interface TransferStateValues {
  sender?: string
  recipient?: string
}

export interface TransferLocationState {
  route?: RouterRouteResponseJson
  quoteVerifiedAt?: number
  recipientAddress?: string
  values?: TransferStateValues
}

interface BuildTransferLocationStateArgs<T extends object> {
  currentState: TransferLocationState
  route: RouterRouteResponseJson | undefined
  quoteVerifiedAt?: number
  hexAddress: string
  values: T
}

function getTransferRecipient(recipientAddress: string | undefined, hexAddress: string) {
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
      slippagePercent: "0.1",
      ...values,
    },
  }
}

function getTransferStateAddresses(state: TransferLocationState) {
  return { recipient: state.values?.recipient, sender: state.values?.sender }
}

export function shouldSyncTransferNavigationState({
  currentState,
  nextState,
}: {
  currentState: TransferLocationState
  nextState: TransferLocationState
}): boolean {
  if (currentState.route !== nextState.route) return true
  if (currentState.quoteVerifiedAt !== nextState.quoteVerifiedAt) return true

  const currentAddresses = getTransferStateAddresses(currentState)
  const nextAddresses = getTransferStateAddresses(nextState)

  return (
    currentAddresses.sender !== nextAddresses.sender ||
    currentAddresses.recipient !== nextAddresses.recipient
  )
}

export type TransferBackNavigation =
  | { type: "exit" }
  | { type: "page"; page: "select-local" | "select-external"; clearLocal: boolean }

/**
 * Where the fields page's back arrow goes. When hasSingleExternalAssetOption,
 * navigating to select-external would auto-fill and jump back to fields, an
 * infinite loop. Embedded in the deposit hub (canExit), leave to the method hub
 * instead; standalone, go directly to select-local — neither loops.
 * `clearLocal` clears the local asset selection when the destination is the
 * select-local picker, so it reopens with nothing pre-selected.
 */
export function getTransferBackNavigation({
  mode,
  hasSingleExternalAssetOption,
  canExit,
}: {
  mode: TransferMode
  hasSingleExternalAssetOption: boolean
  canExit: boolean
}): TransferBackNavigation {
  if (mode === "deposit" && hasSingleExternalAssetOption && canExit) {
    return { type: "exit" }
  }

  const toSelectLocal = mode === "withdraw" || hasSingleExternalAssetOption
  return {
    type: "page",
    page: toSelectLocal ? "select-local" : "select-external",
    clearLocal: toSelectLocal,
  }
}
