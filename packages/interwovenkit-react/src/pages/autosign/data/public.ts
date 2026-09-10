import { useSetAtom } from "jotai"
import { useConfig } from "@/data/config"
import { useDrawer } from "@/data/ui"
import { useInitiaAddress } from "@/public/data/hooks"
import { useDisableAutoSign } from "./actions"
import { resolveAutoSignDuration } from "./constants"
import { pendingAutoSignRequestAtom } from "./store"
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
  const setPendingAutoSignRequest = useSetAtom(pendingAutoSignRequestAtom)
  const disableAutoSign = useDisableAutoSign()
  const { data = EMPTY_AUTOSIGN_STATUS, isLoading } = useAutoSignStatus()

  const enable = async (chainId: string = defaultChainId, options?: EnableAutoSignOptions) => {
    return new Promise<void>((resolve, reject) => {
      if (!owner) {
        reject(new Error("Wallet not connected"))
        return
      }
      setPendingAutoSignRequest({
        owner,
        chainId,
        defaultDuration: resolveAutoSignDuration(options?.defaultDuration),
        stayConnected: options?.stayConnected,
        resolve,
        reject,
      })
      openDrawer("/autosign/enable")
    })
  }

  const disable = async (chainId: string = defaultChainId) => {
    await disableAutoSign.mutateAsync(chainId)
  }

  return { ...data, isLoading, enable, disable }
}
