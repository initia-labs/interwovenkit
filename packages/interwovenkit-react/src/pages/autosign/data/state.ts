import { useEffect, useMemo, useState } from "react"
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai"
import { useFindChain } from "@/data/chains"
import { useInitiaAddress } from "@/public/data/hooks"
import { useAutoSignPermissions } from "./permissions"
import { checkAutoSignEnabled } from "./queries"
import { useEmbeddedWalletAddress } from "./wallet"

interface PendingAutoSignRequest {
  resolve: () => void
  reject: (error: Error) => void
}

export const pendingAutoSignRequestAtom = atom<PendingAutoSignRequest | null>(null)

export const autoSignExpirationAtom = atom<Record<string, number | undefined>>({})
export const autoSignLoadingAtom = atom<boolean>(true)

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
      // Perform the actual check
      const result = await Promise.all(
        Object.entries(autoSignPermissions).map(
          async ([chainId, permission]) =>
            [
              chainId,
              await checkAutoSignEnabled(
                address,
                embeddedWalletAddress,
                permission,
                findChain(chainId).restUrl,
              ),
            ] as [string, { enabled: boolean; expiresAt?: number }],
        ),
      )

      setExpirations(
        Object.fromEntries(
          result.map(([chainId, res]) => [chainId, res.enabled ? res.expiresAt : undefined]),
        ),
      )

      return Object.fromEntries(result.map(([chainId, res]) => [chainId, res.enabled]))
    } finally {
      setLoading(false)
    }
  }

  return {
    expirations,
    isEnabled,
    checkAutoSign,
  }
}

export function useIsAutoSignEnabled() {
  const expirations = useAtomValue(autoSignExpirationAtom)
  const [expirationCheckTick, setExpirationCheckTick] = useState(0)

  const isEnabled = useMemo(
    () => parseExpirationTimes(expirations),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- expirationCheckTick is used to force re-evaluation when expiration timer fires
    [expirations, expirationCheckTick],
  )

  useEffect(() => {
    const expiration = getEarliestExpiration(expirations)
    if (!expiration) return

    // Set up timer to disable when expiration is reached
    const timeoutId = setTimeout(() => {
      setExpirationCheckTick((currentTick) => currentTick + 1)
    }, expiration - Date.now())

    return () => clearTimeout(timeoutId)
  }, [expirations])

  return isEnabled
}

/**
 * Parse expiration times and check if they're still valid
 */
export function parseExpirationTimes(expirations: Record<string, number | undefined>) {
  return Object.fromEntries(
    Object.entries(expirations).map(([chainId, expirationTime]) => {
      return [chainId, !!expirationTime && expirationTime > Date.now()]
    }),
  )
}

/**
 * Get the earliest expiration time from a record of expirations
 */
export function getEarliestExpiration(expirations: Record<string, number | undefined>) {
  const validExpirations = Object.values(expirations).filter(
    (expiration) => !!expiration && expiration > Date.now(),
  ) as number[]

  if (validExpirations.length === 0) return undefined
  return Math.min(...validExpirations)
}
