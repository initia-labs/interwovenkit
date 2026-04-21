import { useSetAtom } from "jotai"
import { useConfig } from "@/data/config"
import { useDrawer } from "@/data/ui"
import { useDisableAutoSign } from "./actions"
import { resolveAutoSignDuration } from "./constants"
import { pendingAutoSignRequestAtom } from "./store"
import { useAutoSignStatus } from "./validation"

interface EnableAutoSignOptions {
  defaultDuration?: number
}

/* Public hook for enabling and disabling AutoSign across chains with status tracking */
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

  const enable = async (chainId: string = defaultChainId, options?: EnableAutoSignOptions) => {
    return new Promise<void>((resolve, reject) => {
      setPendingAutoSignRequest({
        chainId,
        defaultDuration: resolveAutoSignDuration(options?.defaultDuration),
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
