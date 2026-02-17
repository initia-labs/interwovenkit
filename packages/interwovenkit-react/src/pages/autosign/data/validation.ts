import type { EncodeObject } from "@cosmjs/proto-signing"
import { isFuture } from "date-fns"
import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { useDefaultChain } from "@/data/chains"
import { useConfig } from "@/data/config"
import { STALE_TIMES } from "@/data/http"
import { useInitiaAddress } from "@/public/data/hooks"
import type { FeegrantAllowance } from "./fetch"
import { getFeegrantAllowedMessages, getFeegrantExpiration, useAutoSignApi } from "./fetch"
import { getExpectedAddress } from "./wallet"

export const autoSignQueryKeys = createQueryKeys("interwovenkit:autosign", {
  expirations: (address: string | undefined, messageTypesKey: string) => [address, messageTypesKey],
  grants: (chainId: string, address: string | undefined) => [chainId, address],
})

const CHAIN_STATUS_CONCURRENCY = 4
const FEEGRANT_CANDIDATE_CONCURRENCY = 4

export function createAutoSignMessageTypesKey(messageTypes: Record<string, string[]>): string {
  return Object.entries(messageTypes)
    .sort(([chainA], [chainB]) => chainA.localeCompare(chainB))
    .map(([chainId, types]) => `${chainId}:${[...types].sort().join(",")}`)
    .join("|")
}

function parseAutoSignMessageTypesKey(messageTypesKey: string): Array<[string, string[]]> {
  if (!messageTypesKey) return []

  return messageTypesKey
    .split("|")
    .filter(Boolean)
    .map((entry): [string, string[]] => {
      const separatorIndex = entry.indexOf(":")
      if (separatorIndex === -1) {
        return [entry, []]
      }

      const chainId = entry.slice(0, separatorIndex)
      const joinedTypes = entry.slice(separatorIndex + 1)
      const types = joinedTypes ? joinedTypes.split(",").filter(Boolean) : []

      return [chainId, types]
    })
}

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
  const messageTypesKey = createAutoSignMessageTypesKey(messageTypes)
  const { fetchFeegrant, fetchAllGrants } = useAutoSignApi()

  return useQuery({
    queryKey: autoSignQueryKeys.expirations(initiaAddress, messageTypesKey).queryKey,
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
      const expectedAddressByChain: Record<string, string | null | undefined> = {}
      const chainEntries = parseAutoSignMessageTypesKey(messageTypesKey)

      const chainResults = await mapWithConcurrency(
        chainEntries,
        CHAIN_STATUS_CONCURRENCY,
        async ([chainId, msgTypes]) => {
          const expectedAddress = getExpectedAddress(initiaAddress, chainId)

          try {
            const allGrants = await fetchAllGrants(chainId)
            const grantsToCheck = expectedAddress
              ? allGrants.filter((grant) => grant.grantee === expectedAddress)
              : allGrants
            const validGranteeCandidates = findValidGranteeCandidates(grantsToCheck, msgTypes)

            if (validGranteeCandidates.length === 0) {
              return {
                chainId,
                expectedAddress,
                expiration: null,
                grantee: undefined as string | undefined,
              }
            }

            const validGrantee = await findValidGranteeWithFeegrant({
              chainId,
              candidates: validGranteeCandidates,
              fetchFeegrant,
              concurrency: FEEGRANT_CANDIDATE_CONCURRENCY,
            })
            if (!validGrantee) {
              return {
                chainId,
                expectedAddress,
                expiration: null,
                grantee: undefined as string | undefined,
              }
            }

            const grantExpirations = validGrantee.grantee.grants
              .filter((grant) => msgTypes.includes(grant.authorization.msg))
              .map((grant) => grant.expiration)
            const feegrantExpiration = getFeegrantExpiration(validGrantee.feegrant.allowance)
            const allExpirations = [...grantExpirations, feegrantExpiration]
            const earliestExpiration = findEarliestDate(allExpirations)

            return {
              chainId,
              expectedAddress,
              expiration: earliestExpiration ? new Date(earliestExpiration) : undefined,
              grantee: validGrantee.grantee.grantee,
            }
          } catch {
            return {
              chainId,
              expectedAddress,
              expiration: null,
              grantee: undefined as string | undefined,
            }
          }
        },
      )

      for (const result of chainResults) {
        expectedAddressByChain[result.chainId] = result.expectedAddress
        expiredAtByChain[result.chainId] = result.expiration
        granteeByChain[result.chainId] = result.grantee
      }

      const isEnabledByChain: Record<string, boolean> = {}
      for (const [chainId, expiration] of Object.entries(expiredAtByChain)) {
        isEnabledByChain[chainId] = resolveAutoSignEnabledForChain({
          expiration,
          grantee: granteeByChain[chainId],
          expectedAddress: expectedAddressByChain[chainId],
        })
      }

      return {
        expiredAtByChain,
        isEnabledByChain,
        granteeByChain,
      }
    },
    staleTime: STALE_TIMES.MINUTE,
    retry: 1,
  })
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  const maxConcurrency = Math.max(1, concurrency)
  let nextIndex = 0

  const workers = Array.from({ length: Math.min(maxConcurrency, items.length) }, async () => {
    while (true) {
      const currentIndex = nextIndex
      nextIndex += 1

      if (currentIndex >= items.length) {
        return
      }

      results[currentIndex] = await mapper(items[currentIndex]!, currentIndex)
    }
  })

  await Promise.all(workers)
  return results
}

interface GrantWithGrantee {
  grantee: string
  grants: Array<{ authorization: { msg: string }; expiration?: string }>
}

export function isFeegrantEligibleForAutoSign(feegrant: FeegrantAllowance): boolean {
  const feegrantAllowedMessages = getFeegrantAllowedMessages(feegrant.allowance)
  const allowsAuthzExec =
    !feegrantAllowedMessages || feegrantAllowedMessages.includes("/cosmos.authz.v1beta1.MsgExec")
  if (!allowsAuthzExec) {
    return false
  }

  const expiration = getFeegrantExpiration(feegrant.allowance)
  if (!expiration) {
    return true
  }

  const expirationDate = new Date(expiration)
  return !Number.isNaN(expirationDate.getTime()) && isFuture(expirationDate)
}

export async function findValidGranteeWithFeegrant(params: {
  chainId: string
  candidates: GrantWithGrantee[]
  fetchFeegrant: (chainId: string, grantee: string) => Promise<FeegrantAllowance | null>
  concurrency?: number
}): Promise<{ grantee: GrantWithGrantee; feegrant: FeegrantAllowance } | null> {
  const {
    chainId,
    candidates,
    fetchFeegrant,
    concurrency = FEEGRANT_CANDIDATE_CONCURRENCY,
  } = params
  const feegrantChecks = await mapWithConcurrency(candidates, concurrency, async (candidate) => {
    const feegrant = await fetchFeegrant(chainId, candidate.grantee)
    if (!feegrant) {
      return null
    }

    if (isFeegrantEligibleForAutoSign(feegrant)) {
      return { grantee: candidate, feegrant }
    }

    return null
  })

  for (const result of feegrantChecks) {
    if (result) {
      return result
    }
  }

  return null
}

export function findValidGranteeCandidates(
  allGrants: Array<{ grantee: string; authorization: { msg: string }; expiration?: string }>,
  requiredMsgTypes: string[],
): GrantWithGrantee[] {
  if (requiredMsgTypes.length === 0) {
    return []
  }

  const grantsByGrantee = new Map<
    string,
    Array<{ authorization: { msg: string }; expiration?: string }>
  >()

  for (const grant of allGrants) {
    const existing = grantsByGrantee.get(grant.grantee) || []
    existing.push({ authorization: grant.authorization, expiration: grant.expiration })
    grantsByGrantee.set(grant.grantee, existing)
  }

  const candidates: GrantWithGrantee[] = []
  for (const [grantee, grants] of grantsByGrantee) {
    const validGrants = grants.filter((g) => !g.expiration || isFuture(new Date(g.expiration)))
    const grantedMsgTypes = validGrants.map((g) => g.authorization.msg)
    const hasAllTypes = requiredMsgTypes.every((msgType) => grantedMsgTypes.includes(msgType))
    if (hasAllTypes) {
      candidates.push({ grantee, grants: validGrants })
    }
  }

  return candidates
}

export function resolveAutoSignEnabledForChain(params: {
  expiration: Date | null | undefined
  grantee?: string
  expectedAddress?: string | null | undefined
}): boolean {
  const { expiration, grantee, expectedAddress } = params
  const addressMatches =
    expectedAddress == null ? !!grantee : !!grantee && expectedAddress === grantee

  switch (expiration) {
    case null:
      return false
    case undefined:
      return addressMatches
    default:
      return addressMatches && isFuture(expiration)
  }
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
