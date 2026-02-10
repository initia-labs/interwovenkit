import type { EncodeObject } from "@cosmjs/proto-signing"
import { isFuture } from "date-fns"
import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { useDefaultChain } from "@/data/chains"
import { useConfig } from "@/data/config"
import { STALE_TIMES } from "@/data/http"
import { useInitiaAddress } from "@/public/data/hooks"
import { getFeegrantAllowedMessages, getFeegrantExpiration, useAutoSignApi } from "./fetch"
import { getExpectedAddress } from "./wallet"

export const autoSignQueryKeys = createQueryKeys("interwovenkit:autosign", {
  expirations: (address: string | undefined) => [address],
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
  const messageTypes = useAutoSignMessageTypes()
  const { fetchFeegrant, fetchAllGrants } = useAutoSignApi()

  return useQuery({
    queryKey: autoSignQueryKeys.expirations(initiaAddress).queryKey,
    queryFn: async () => {
      if (!initiaAddress) {
        return {
          expiredAtByChain: {},
          isEnabledByChain: {},
          granteeByChain: {},
        }
      }

      const expiredAtByChain: Record<string, Date | null | undefined> = {}
      const granteeByChain: Record<string, string | undefined> = {}
      const expectedAddressByChain: Record<string, string | null> = {}

      for (const [chainId, msgTypes] of Object.entries(messageTypes)) {
        try {
          const expectedAddress = getExpectedAddress(initiaAddress, chainId)
          expectedAddressByChain[chainId] = expectedAddress
          const allGrants = await fetchAllGrants(chainId)

          const grantsToCheck = expectedAddress
            ? allGrants.filter((grant) => grant.grantee === expectedAddress)
            : allGrants
          const validGrantee = findValidGrantee(grantsToCheck, msgTypes)

          if (!validGrantee) {
            expiredAtByChain[chainId] = null
            continue
          }

          granteeByChain[chainId] = validGrantee.grantee

          const feegrant = await fetchFeegrant(chainId, validGrantee.grantee)

          if (!feegrant) {
            expiredAtByChain[chainId] = null
            continue
          }

          const feegrantAllowedMessages = getFeegrantAllowedMessages(feegrant.allowance)
          const allowsAuthzExec =
            !feegrantAllowedMessages ||
            feegrantAllowedMessages.includes("/cosmos.authz.v1beta1.MsgExec")

          if (!allowsAuthzExec) {
            expiredAtByChain[chainId] = null
            continue
          }

          const grantExpirations = validGrantee.grants
            .filter((grant) => msgTypes.includes(grant.authorization.msg))
            .map((grant) => grant.expiration)

          const feegrantExpiration = getFeegrantExpiration(feegrant.allowance)
          const allExpirations = [...grantExpirations, feegrantExpiration]
          const earliestExpiration = findEarliestDate(allExpirations)
          expiredAtByChain[chainId] = earliestExpiration ? new Date(earliestExpiration) : undefined
        } catch {
          expiredAtByChain[chainId] = null
        }
      }

      const isEnabledByChain: Record<string, boolean> = {}
      for (const [chainId, expiration] of Object.entries(expiredAtByChain)) {
        const grantee = granteeByChain[chainId]
        const expectedAddress = expectedAddressByChain[chainId]
        const addressMatches = grantee && expectedAddress === grantee

        switch (expiration) {
          case null:
            isEnabledByChain[chainId] = false
            break
          case undefined:
            isEnabledByChain[chainId] = !!addressMatches
            break
          default:
            isEnabledByChain[chainId] = !!addressMatches && isFuture(expiration)
            break
        }
      }

      return {
        expiredAtByChain,
        isEnabledByChain,
        granteeByChain,
      }
    },
    staleTime: STALE_TIMES.INFINITY,
    retry: false,
  })
}

interface GrantWithGrantee {
  grantee: string
  grants: Array<{ authorization: { msg: string }; expiration?: string }>
}

export function findValidGrantee(
  allGrants: Array<{ grantee: string; authorization: { msg: string }; expiration?: string }>,
  requiredMsgTypes: string[],
): GrantWithGrantee | null {
  const grantsByGrantee = new Map<
    string,
    Array<{ authorization: { msg: string }; expiration?: string }>
  >()

  for (const grant of allGrants) {
    const existing = grantsByGrantee.get(grant.grantee) || []
    existing.push({ authorization: grant.authorization, expiration: grant.expiration })
    grantsByGrantee.set(grant.grantee, existing)
  }

  for (const [grantee, grants] of grantsByGrantee) {
    const validGrants = grants.filter((g) => !g.expiration || isFuture(new Date(g.expiration)))
    const grantedMsgTypes = validGrants.map((g) => g.authorization.msg)
    const hasAllTypes = requiredMsgTypes.every((msgType) => grantedMsgTypes.includes(msgType))
    if (hasAllTypes) {
      return { grantee, grants: validGrants }
    }
  }

  return null
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
    if (!earliestExpiration) return

    const timeUntilExpiration = earliestExpiration.getTime() - now.getTime()

    if (timeUntilExpiration <= 0) return

    const timeoutId = setTimeout(() => {
      refetch()
    }, timeUntilExpiration + 100)

    return () => clearTimeout(timeoutId)
  }, [data, refetch])
}

/* Find earliest date from array of dates, handling string and undefined values */
export function findEarliestDate<T extends Date | string>(dates: (T | undefined)[]): T | undefined {
  const filtered = dates.filter((date): date is T => date !== undefined)
  if (filtered.length === 0) return undefined
  return [...filtered].sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0]
}
