import { addWeeks, isFuture } from "date-fns"
import ky from "ky"
import { useSignMessage } from "wagmi"
import { useCallback, useMemo } from "react"
import { useLocalStorage } from "usehooks-ts"
import { useInitiaAddress } from "@/public/data/hooks"
import { useConfig } from "./config"
import { LocalStorageKey } from "./constants"

interface ApiAuthCredentials {
  signature: string
  expiresAt: string
}

export function useInterwovenKitApi() {
  const { interwovenkitApiUrl } = useConfig()
  const initiaAddress = useInitiaAddress()
  const localStorageKey = `${LocalStorageKey.API_AUTH_SESSION}:${initiaAddress}`
  const { signMessageAsync } = useSignMessage()
  const [cachedCredentials, setCachedCredentials] = useLocalStorage<ApiAuthCredentials | null>(
    localStorageKey,
    null,
  )

  const interwovenkitApi = useMemo(
    () => ky.create({ prefixUrl: interwovenkitApiUrl }),
    [interwovenkitApiUrl],
  )

  const getOrRefreshCredentials = useCallback(async (): Promise<ApiAuthCredentials> => {
    if (cachedCredentials && isFuture(new Date(cachedCredentials.expiresAt))) {
      return cachedCredentials
    }

    const expiresAt = addWeeks(new Date(), 2).toISOString()
    const { message } = await interwovenkitApi
      .get("auto-sign/get-message", {
        headers: {
          "x-expiration": expiresAt,
        },
      })
      .json<{ message: string }>()

    const signature = await signMessageAsync({ message })
    const refreshedCredentials = { signature, expiresAt }

    setCachedCredentials(refreshedCredentials)

    return refreshedCredentials
  }, [cachedCredentials, interwovenkitApi, setCachedCredentials, signMessageAsync])

  const createAuthenticatedInterwovenkitApi = useCallback(async () => {
    const { signature, expiresAt } = await getOrRefreshCredentials()

    return interwovenkitApi.extend({
      headers: {
        "user-address": initiaAddress,
        "auth-signature": signature,
        "x-expiration": expiresAt,
      },
    })
  }, [getOrRefreshCredentials, initiaAddress, interwovenkitApi])

  return useMemo(
    () => ({ interwovenkitApi, createAuthenticatedInterwovenkitApi }),
    [createAuthenticatedInterwovenkitApi, interwovenkitApi],
  )
}
