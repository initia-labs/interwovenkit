import { useEffect, useState } from "react"
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai"
import { useFindChain } from "@/data/chains"
import { useInitiaAddress } from "@/public/data/hooks"
import { useAutoSignPermissions } from "./permissions"
import { checkAutoSignExpiration } from "./queries"
import { useEmbeddedWalletAddress } from "./wallet"

interface PendingAutoSignRequest {
  resolve: () => void
  reject: (error: Error) => void
}

export const pendingAutoSignRequestAtom = atom<PendingAutoSignRequest | null>(null)

export const autoSignExpirationAtom = atom<Record<string, number | null>>({})
export const autoSignLoadingAtom = atom<boolean>(true)

/**
 * Hook that manages the complete auto-sign state including enabled status and expiration times.
 * Provides functionality to check auto-sign permissions across multiple chains and tracks their expiration.
 * Handles loading states and caches enabled status to avoid redundant API calls.
 */
export function useAutoSignState() {
  const isEnabled = useIsAutoSignEnabled()
  const [expirations, setExpirations] = useAtom(autoSignExpirationAtom)
  const setLoading = useSetAtom(autoSignLoadingAtom)
  const address = useInitiaAddress()
  const findChain = useFindChain()
  const embeddedWalletAddress = useEmbeddedWalletAddress()
  const autoSignPermissions = useAutoSignPermissions()

  const checkAutoSign = async (): Promise<Record<string, boolean>> => {
    if (!embeddedWalletAddress || !address || !autoSignPermissions) {
      setLoading(false)
      return {}
    }

    // If already enabled and not expired, return true
    if (Object.values(isEnabled).some((v) => v)) {
      setLoading(false)
      return isEnabled
    }

    try {
      const results = await Promise.all(
        Object.entries(autoSignPermissions).map(async ([chainId, permission]) => {
          const { restUrl } = findChain(chainId)
          const result = await checkAutoSignExpiration(
            address,
            embeddedWalletAddress,
            permission,
            restUrl,
          )
          return [chainId, result] as const
        }),
      )

      setExpirations(Object.fromEntries(results.map(([chainId, result]) => [chainId, result])))

      return Object.fromEntries(results.map(([chainId, result]) => [chainId, !!result]))
    } finally {
      setLoading(false)
    }
  }

  return { expirations, isEnabled, checkAutoSign }
}

/**
 * Hook that determines whether auto-sign is currently enabled for each chain.
 * Automatically re-evaluates when permissions expire by setting up timers.
 * Ensures UI updates immediately when auto-sign permissions expire.
 */
export function useIsAutoSignEnabled() {
  const expirations = useAtomValue(autoSignExpirationAtom)
  const [isEnabled, setIsEnabled] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const expiration = getEarliestExpiration(expirations)
    if (!expiration) return

    const timeoutId = setTimeout(() => {
      setIsEnabled(parseExpirationTimes(expirations))
    }, expiration - Date.now())

    return () => clearTimeout(timeoutId)
  }, [expirations])

  return isEnabled
}

/**
 * Parses expiration times and determines validity status for each chain.
 * Converts Unix timestamp expirations to boolean enabled/disabled status based on current time.
 */
export function parseExpirationTimes(expirations: Record<string, number | null>) {
  return Object.fromEntries(
    Object.entries(expirations).map(([chainId, expirationTime]) => {
      return [chainId, !!expirationTime && expirationTime > Date.now()]
    }),
  )
}

/**
 * Finds the earliest valid expiration time from multiple chain expirations.
 * Filters out expired or undefined values and returns the minimum future timestamp.
 * Used to determine when the next permission will expire for timer setup.
 */
export function getEarliestExpiration(expirations: Record<string, number | null>) {
  const validExpirations = Object.values(expirations).filter(
    (expiration) => !!expiration && expiration > Date.now(),
  ) as number[]

  if (validExpirations.length === 0) return undefined
  return Math.min(...validExpirations)
}
