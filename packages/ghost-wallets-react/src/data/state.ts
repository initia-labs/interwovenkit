import { useAtomValue } from "jotai"
import { ghostWalletExpirationAtom } from "./atoms"
import { useEffect, useState } from "react"

export function useIsGhostWalletEnabled() {
  const expirations = useAtomValue(ghostWalletExpirationAtom)
  const [isEnabled, setIsEnabled] = useState(parseExpirationTimes(expirations))

  useEffect(() => {
    setIsEnabled(parseExpirationTimes(expirations))

    const expiration = getEarliestExpiration(expirations)
    if (!expiration) return

    // Set up timer to disable when expiration is reached
    const timeoutId = setTimeout(() => {
      setIsEnabled(parseExpirationTimes(expirations))
    }, expiration - Date.now())

    return () => clearTimeout(timeoutId)
  }, [expirations])

  return isEnabled
}

/* utils */
function parseExpirationTimes(expirations: Record<string, number | undefined>) {
  return Object.fromEntries(
    Object.entries(expirations).map(([chainId, expirationTime]) => {
      return [chainId, expirationTime ? new Date(expirationTime) : undefined]
    }),
  )
}

function getEarliestExpiration(expirations: Record<string, number | undefined>) {
  const validExpirations = Object.values(expirations).filter(
    (expiration) => !!expiration && expiration > Date.now(),
  ) as number[]

  if (validExpirations.length === 0) return undefined
  return Math.min(...validExpirations)
}
