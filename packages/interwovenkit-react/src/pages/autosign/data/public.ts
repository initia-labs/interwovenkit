import { useSetAtom } from "jotai"
import { useConfig } from "@/data/config"
import { useDrawer } from "@/data/ui"
import { useDisableAutoSign } from "./actions"
import { pendingAutoSignRequestAtom } from "./store"
import { useAutoSignStatus } from "./validation"

/**
 * Hook to read AutoSign status per chain and to request enabling or disabling AutoSign.
 *
 * Provides per-chain metadata about AutoSign expiration, enablement, and grantee, plus helpers to initiate enable or disable actions.
 *
 * @returns An object containing:
 * - `expiredAtByChain`: Record mapping chain IDs to the AutoSign expiration `Date`, `null` if expired, or `undefined` if unknown.
 * - `isEnabledByChain`: Record mapping chain IDs to `true` if AutoSign is enabled on that chain, `false` otherwise.
 * - `granteeByChain`: Record mapping chain IDs to the grantee address when present, or `undefined` if none.
 * - `isLoading`: `true` while status is being fetched, `false` otherwise.
 * - `enable(chainId?)`: A function that initiates an enable request for the given chain ID (defaults to the configured default) and returns a `Promise<void>` that resolves when the enable request completes or rejects if the request is rejected.
 * - `disable(chainId?)`: A function that disables AutoSign for the given chain ID (defaults to the configured default) and returns a `Promise<void>` that resolves when the disable operation completes.
 */
export function useAutoSign() {
  const { defaultChainId } = useConfig()
  const { openDrawer } = useDrawer()
  const setPendingAutoSignRequest = useSetAtom(pendingAutoSignRequestAtom)
  const disableAutoSign = useDisableAutoSign()
  const {
    data = {
      expiredAtByChain: {} as Record<string, Date | null | undefined>,
      isEnabledByChain: {} as Record<string, boolean>,
      granteeByChain: {} as Record<string, string | undefined>,
    },
    isLoading,
  } = useAutoSignStatus()

  const enable = async (chainId: string = defaultChainId) => {
    return new Promise<void>((resolve, reject) => {
      setPendingAutoSignRequest({ chainId, resolve, reject })
      openDrawer("/autosign/enable")
    })
  }

  const disable = async (chainId: string = defaultChainId) => {
    await disableAutoSign.mutateAsync(chainId)
  }

  return { ...data, isLoading, enable, disable }
}