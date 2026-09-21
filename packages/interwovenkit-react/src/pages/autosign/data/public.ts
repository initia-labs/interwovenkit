import { useStore } from "jotai"
import { useConfig } from "@/data/config"
import { useDrawer } from "@/data/ui"
import { useInitiaAddress } from "@/public/data/hooks"
import { useDisableAutoSign } from "./actions"
import { resolveAutoSignDuration } from "./constants"
import { AutoSignCancelledError } from "./storage"
import { type PendingAutoSignRequest, pendingAutoSignRequestAtom } from "./store"
import { type AutoSignStatusResult, useAutoSignStatus } from "./validation"

export interface EnableAutoSignOptions {
  defaultDuration?: number
  /** Selects browser persistence when true or tab-only storage when false.
   * Omit it to use the saved preference, which defaults to browser persistence.
   * The provider's memory-only mode always takes precedence. */
  stayConnected?: boolean
}

export interface AutoSignResult extends AutoSignStatusResult {
  isLoading: boolean
  enable: (chainId?: string, options?: EnableAutoSignOptions) => Promise<void>
  disable: (chainId?: string) => Promise<void>
}

const EMPTY_AUTOSIGN_STATUS: AutoSignStatusResult = Object.freeze({
  expiredAtByChain: Object.freeze({}),
  feegrantByChain: Object.freeze({}),
  isEnabledByChain: Object.freeze({}),
  granteeByChain: Object.freeze({}),
  requestedDurationInMsByChain: Object.freeze({}),
  statusByChain: Object.freeze({}),
})

/* Public hook for enabling and disabling AutoSign across chains with status tracking */
export function useAutoSign(): AutoSignResult {
  const { defaultChainId } = useConfig()
  const owner = useInitiaAddress()
  const { openDrawer } = useDrawer()
  const store = useStore()
  const disableAutoSign = useDisableAutoSign()
  const { data = EMPTY_AUTOSIGN_STATUS, isLoading } = useAutoSignStatus()

  const enable = async (chainId: string = defaultChainId, options?: EnableAutoSignOptions) => {
    return new Promise<void>((resolve, reject) => {
      if (!owner) {
        reject(new Error("Wallet not connected"))
        return
      }
      if (store.get(pendingAutoSignRequestAtom)) {
        reject(new AutoSignCancelledError("Another autosign approval is already in progress"))
        return
      }

      let settled = false
      const request: PendingAutoSignRequest = {
        owner,
        chainId,
        defaultDuration: resolveAutoSignDuration(options?.defaultDuration),
        stayConnected: options?.stayConnected,
        resolve: () => {
          if (settled) return
          settled = true
          resolve()
        },
        reject: (error) => {
          if (settled) return
          settled = true
          reject(error)
        },
      }
      store.set(pendingAutoSignRequestAtom, request)
      try {
        openDrawer("/autosign/enable")
      } catch (error) {
        request.reject(error instanceof Error ? error : new Error(String(error)))
        if (store.get(pendingAutoSignRequestAtom) === request) {
          store.set(pendingAutoSignRequestAtom, null)
        }
      }
    })
  }

  const disable = async (chainId: string = defaultChainId) => {
    await disableAutoSign.mutateAsync(chainId)
  }

  return { ...data, isLoading, enable, disable }
}
