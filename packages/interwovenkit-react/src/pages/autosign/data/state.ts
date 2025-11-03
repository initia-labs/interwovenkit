import { isPast } from "date-fns"
import { atom, useAtom, useSetAtom } from "jotai"
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
    if (Object.values(expirations).some((v) => v && isPast(new Date(v)))) {
      setLoading(false)
      return parseExpirationTimes(expirations)
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

  return { expirations, checkAutoSign }
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
