import type { EncodeObject } from "@cosmjs/proto-signing"
import { isFuture } from "date-fns"
import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { useDefaultChain } from "@/data/chains"
import { useConfig } from "@/data/config"
import { STALE_TIMES } from "@/data/http"
import { useInitiaAddress } from "@/public/data/hooks"
import { useAutoSignApi } from "./fetch"
import { useEmbeddedWalletAddress } from "./wallet"

export const autoSignQueryKeys = createQueryKeys("interwovenkit:autosign", {
  expirations: (address: string | undefined, embeddedWalletAddress: string | undefined) => [
    address,
    embeddedWalletAddress,
  ],
  grants: (chainId: string, address: string | undefined) => [chainId, address],
})

/* Get configured AutoSign message types for the default chain based on chain type */
export function useAutoSignMessageTypes() {
  const config = useConfig()
  const defaultChain = useDefaultChain()
  const { enableAutoSign, defaultChainId } = config

  // If AutoSign is not enabled, return empty object
  if (!enableAutoSign) return { [defaultChainId]: [] }

  // If specific config provided, return as-is
  if (typeof enableAutoSign !== "boolean") return enableAutoSign

  // If true, return default message type based on chain type
  const minitiaType = defaultChain.metadata?.minitia?.type

  switch (minitiaType) {
    case "minievm":
      return { [defaultChainId]: ["/minievm.evm.v1.MsgCall"] }
    case "miniwasm":
      return { [defaultChainId]: ["/cosmwasm.wasm.v1.MsgExecuteContract"] }
    default:
      return { [defaultChainId]: ["/initia.move.v1.MsgExecute"] }
  }
}

/* Validate whether a transaction can be auto-signed by checking enabled status and message types */
export function useValidateAutoSign() {
  const { data } = useAutoSignStatus()
  const messageTypes = useAutoSignMessageTypes()

  return async (chainId: string, messages: EncodeObject[]) => {
    // Check condition 1: All messages must be in allowed types
    const allMessagesAllowed = messages.every((msg) => {
      const chainMessageTypes = messageTypes[chainId]
      if (!chainMessageTypes) return false
      return chainMessageTypes.includes(msg.typeUrl)
    })

    // Check condition 2: AutoSign must be enabled for the chain
    const isAutoSignEnabled = data?.isEnabledByChain[chainId] ?? false

    return allMessagesAllowed && isAutoSignEnabled
  }
}

/* Get current AutoSign status including enabled state and expiration dates by chain */
export function useAutoSignStatus() {
  const initiaAddress = useInitiaAddress()
  const embeddedWalletAddress = useEmbeddedWalletAddress()
  const messageTypes = useAutoSignMessageTypes()
  const { fetchFeegrant, fetchGrants } = useAutoSignApi()

  return useQuery({
    queryKey: autoSignQueryKeys.expirations(initiaAddress, embeddedWalletAddress).queryKey,
    queryFn: async () => {
      if (!initiaAddress || !embeddedWalletAddress) {
        return {
          expiredAtByChain: {},
          isEnabledByChain: {},
        }
      }

      // Track expiration dates for each chain
      const expiredAtByChain: Record<string, Date | null | undefined> = {}

      // Check each chain's grants and feegrants
      for (const [chainId, msgTypes] of Object.entries(messageTypes)) {
        try {
          const grants = await fetchGrants(chainId, embeddedWalletAddress)

          // Check if all required message types are granted
          const allTypesGranted = msgTypes.every((msgType) =>
            grants.some((grant) => grant.authorization?.msg === msgType),
          )

          if (!allTypesGranted) {
            // No permission for this chain
            expiredAtByChain[chainId] = null
            continue
          }

          const feegrant = await fetchFeegrant(chainId, embeddedWalletAddress)

          if (!feegrant) {
            expiredAtByChain[chainId] = null
            continue
          }

          // Extract expiration dates from grants and feegrant
          const grantExpirations = grants
            .filter((grant) => msgTypes.includes(grant.authorization.msg))
            .map((grant) => grant.expiration)

          const feegrantExpiration = feegrant.allowance.expiration

          // Find the earliest expiration (most restrictive)
          const allExpirations = [...grantExpirations, feegrantExpiration]

          const earliestExpiration = findEarliestDate(allExpirations)
          expiredAtByChain[chainId] = earliestExpiration ? new Date(earliestExpiration) : undefined
        } catch {
          // No permission for this chain (error in fetching)
          expiredAtByChain[chainId] = null
        }
      }

      // Calculate isEnabledByChain based on expiration dates
      const isEnabledByChain: Record<string, boolean> = {}

      for (const [chainId, expiration] of Object.entries(expiredAtByChain)) {
        switch (expiration) {
          case null:
            isEnabledByChain[chainId] = false
            break
          case undefined:
            isEnabledByChain[chainId] = true
            break
          default:
            isEnabledByChain[chainId] = isFuture(expiration)
            break
        }
      }

      return {
        expiredAtByChain,
        isEnabledByChain,
      }
    },
    staleTime: STALE_TIMES.INFINITY,
    retry: false,
  })
}

/* Initialize AutoSign by querying grants and feegrants to determine enabled status and expiration */
export function useInitializeAutoSign() {
  const { data, refetch } = useAutoSignStatus()

  // Update status when the earliest future expiration is reached
  useEffect(() => {
    if (!data) return

    const now = new Date()

    // Filter only future expirations with Date values
    // Exclude null (no permission) and undefined (permanent permission)
    const futureExpirations = Object.values(data.expiredAtByChain).filter(
      (expiration): expiration is Date => expiration instanceof Date && isFuture(expiration),
    )

    if (futureExpirations.length === 0) return

    const earliestExpiration = findEarliestDate(futureExpirations)
    const timeUntilExpiration = earliestExpiration.getTime() - now.getTime()

    if (timeUntilExpiration <= 0) return

    const timeoutId = setTimeout(() => {
      refetch()
    }, timeUntilExpiration + 100)

    return () => clearTimeout(timeoutId)
  }, [data, refetch])
}

/* Find earliest date from array of dates, handling string and undefined values */
export function findEarliestDate<T extends Date | string | undefined>(dates: T[]): T {
  return dates
    .filter((date) => date !== undefined)
    .toSorted((a, b) => new Date(a).getTime() - new Date(b).getTime())[0]!
}
