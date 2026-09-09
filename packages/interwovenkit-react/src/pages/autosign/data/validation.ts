import type { EncodeObject } from "@cosmjs/proto-signing"
import { isFuture } from "date-fns"
import { useEffect, useEffectEvent } from "react"
import { useEventCallback } from "usehooks-ts"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { useDefaultChain, useInitiaRegistry } from "@/data/chains"
import { type Config, useConfig } from "@/data/config"
import { STALE_TIMES } from "@/data/http"
import { useInitiaAddress } from "@/public/data/hooks"
import type { FeegrantAllowance } from "./fetch"
import {
  getFeegrantAllowedMessages,
  getFeegrantExpiration,
  getFeegrantSpendLimit,
  useAutoSignApi,
} from "./fetch"
import { withAutoSignOperation } from "./lifecycle"
import {
  type AutoSignPermissionPolicy,
  doesObservedAuthorizationMatchPolicy,
  EVM_CALL_MESSAGE_TYPE,
  isAutoSignMessageTypeAllowed,
  MOVE_EXECUTE_MESSAGE_TYPE,
  observedAuthorizationToPermissionPolicy,
  parseObservedAuthorization,
  validateAutoSignMessages,
  WASM_EXECUTE_MESSAGE_TYPE,
} from "./policy"
import { getExpectedAddress, useDeriveWallet } from "./wallet"

export const autoSignQueryKeys = createQueryKeys("interwovenkit:autosign", {
  expirations: (
    address: string | undefined,
    messageTypesKey: string,
    messageTypes: Record<string, string[]>,
    authorizationPoliciesKey: string,
    networkKey: string,
  ) => [address, messageTypesKey, messageTypes, authorizationPoliciesKey, networkKey],
  grants: (chainId: string, address: string | undefined, restUrl: string) => [
    chainId,
    address,
    restUrl,
  ],
})

const CHAIN_STATUS_CONCURRENCY = 4
const FEEGRANT_CANDIDATE_CONCURRENCY = 4
export const AUTO_SIGN_STATUS_MAX_AGE_MS = STALE_TIMES.MINUTE

export type AutoSignChainStatus =
  | "enabled"
  | "disabled"
  | "expired"
  | "needs-permission-update"
  | "unknown"

export interface AutoSignStatusResult {
  expiredAtByChain: Record<string, Date | null | undefined>
  feegrantByChain: Record<string, FeegrantAllowance | undefined>
  isEnabledByChain: Record<string, boolean>
  granteeByChain: Record<string, string | undefined>
  requestedDurationInMsByChain: Record<string, number | undefined>
  observedAuthorizationByChain: Record<string, AutoSignPermissionPolicy | undefined>
  statusByChain: Record<string, AutoSignChainStatus>
}

interface AutoSignChainStatusResult {
  chainId: string
  expectedAddress: string | null | undefined
  expiration: Date | null | undefined
  feegrant?: FeegrantAllowance
  grantee: string | undefined
  requestedDurationMs?: number
  observedAuthorization?: AutoSignPermissionPolicy
  status: AutoSignChainStatus
}

interface FetchAutoSignStatusParams {
  initiaAddress: string | undefined
  messageTypes: Record<string, string[]>
  authorizationPolicies?: Record<string, AutoSignPermissionPolicy | undefined>
  fetchActiveIdentity?: (
    chainId: string,
  ) => Promise<
    { address: string; observedExpiration?: string; requestedDurationMs?: number } | undefined
  >
  fetchKnownIdentity?: (
    chainId: string,
  ) => Promise<
    { address: string; observedExpiration?: string; requestedDurationMs?: number } | undefined
  >
  fetchAllGrants: (chainId: string) => Promise<
    Array<{
      grantee: string
      authorization: { "@type"?: string; msg?: string }
      expiration?: string
    }>
  >
  fetchFeegrant: (chainId: string, grantee: string) => Promise<FeegrantAllowance | null>
}

export function createAutoSignMessageTypesKey(messageTypes: Record<string, string[]>): string {
  return Object.entries(messageTypes)
    .sort(([chainA], [chainB]) => chainA.localeCompare(chainB))
    .map(([chainId, types]) => `${chainId}:${[...types].sort().join(",")}`)
    .join("|")
}

/** Query state must be recent when it authorizes a background signature. */
export function isAutoSignStatusFresh(dataUpdatedAt: number, now = Date.now()): boolean {
  return (
    Number.isFinite(dataUpdatedAt) &&
    dataUpdatedAt > 0 &&
    dataUpdatedAt <= now &&
    now - dataUpdatedAt <= AUTO_SIGN_STATUS_MAX_AGE_MS
  )
}

export function isAutoSignStatusEnabledAndFresh(params: {
  status: AutoSignStatusResult | undefined
  dataUpdatedAt: number
  chainId: string
  now?: number
}): boolean {
  const { status, dataUpdatedAt, chainId, now = Date.now() } = params
  if (!status?.isEnabledByChain[chainId] || !isAutoSignStatusFresh(dataUpdatedAt, now)) {
    return false
  }
  const expiration = status.expiredAtByChain[chainId]
  return expiration === undefined || (expiration instanceof Date && expiration.getTime() > now)
}

/** A Wasm authorization's limits are stateful. Prefer the decoded on-chain
 * authorization when status verified it against the configured policy. */
export function resolveAutoSignValidationAuthorization(params: {
  configured?: AutoSignPermissionPolicy
  observed?: AutoSignPermissionPolicy
}): AutoSignPermissionPolicy | undefined {
  return params.observed ?? params.configured
}

export function createAutoSignNetworkKey(
  registryUrl: string,
  chains: Iterable<{ chainId: string; restUrl: string; rpcUrl: string }>,
  configuredChainIds: Iterable<string>,
): string {
  const configuredIds = new Set(configuredChainIds)
  return [
    registryUrl,
    ...[...chains]
      .filter((chain) => configuredIds.has(chain.chainId))
      .sort((chainA, chainB) => chainA.chainId.localeCompare(chainB.chainId))
      .map((chain) => `${chain.chainId}:${chain.restUrl}:${chain.rpcUrl}`),
  ].join("|")
}

function createAuthorizationPoliciesKey(policies: Record<string, unknown>): string {
  return Object.entries(policies)
    .sort(([chainA], [chainB]) => chainA.localeCompare(chainB))
    .map(
      ([chainId, policy]) =>
        `${chainId}:${JSON.stringify(policy, (_key, value) =>
          typeof value === "bigint" ? value.toString() : value,
        )}`,
    )
    .join("|")
}

/** Explicit policies opt a chain in and take precedence over legacy message lists.
 * A fee budget alone does not enable signing. Explicit false disables every chain. */
export function resolveAutoSignMessageTypes(
  config: Pick<Config, "enableAutoSign" | "defaultChainId" | "autoSignGrantPolicy">,
  defaultMinitiaType?: string,
): Record<string, string[]> {
  const { enableAutoSign, defaultChainId, autoSignGrantPolicy } = config
  if (enableAutoSign === false) return { [defaultChainId]: [] }

  const messageTypes: Record<string, string[]> =
    typeof enableAutoSign === "object" ? { ...enableAutoSign } : {}
  if (enableAutoSign === true) {
    messageTypes[defaultChainId] = [
      defaultMinitiaType === "minievm"
        ? EVM_CALL_MESSAGE_TYPE
        : defaultMinitiaType === "miniwasm"
          ? WASM_EXECUTE_MESSAGE_TYPE
          : MOVE_EXECUTE_MESSAGE_TYPE,
    ]
  }
  for (const [chainId, { authorization }] of Object.entries(autoSignGrantPolicy ?? {})) {
    if (!authorization) continue
    switch (authorization.kind) {
      case "generic":
        messageTypes[chainId] = [...authorization.messageTypes]
        break
      case "move":
        messageTypes[chainId] = [MOVE_EXECUTE_MESSAGE_TYPE]
        break
      case "evm":
        messageTypes[chainId] = [EVM_CALL_MESSAGE_TYPE]
        break
      case "wasm":
        messageTypes[chainId] = [WASM_EXECUTE_MESSAGE_TYPE]
        break
    }
  }
  return Object.keys(messageTypes).length ? messageTypes : { [defaultChainId]: [] }
}

export function useAutoSignMessageTypes() {
  const config = useConfig()
  const defaultChain = useDefaultChain()
  return resolveAutoSignMessageTypes(config, defaultChain.metadata?.minitia?.type)
}

/* Validate whether a transaction can be auto-signed by checking enabled status and message types */
export function useValidateAutoSign() {
  const { data, dataUpdatedAt } = useAutoSignStatus()
  const messageTypes = useAutoSignMessageTypes()
  const { autoSignGrantPolicy } = useConfig()

  return useEventCallback((chainId: string, messages: EncodeObject[], expectedGrantee?: string) => {
    // Check condition 1: All messages must be in allowed types
    // Wasm limits are consumed on-chain. Once the exact observed grant has
    // been decoded, validate against its remaining allowance rather than the
    // original configured ceiling.
    const authorization = resolveAutoSignValidationAuthorization({
      configured: autoSignGrantPolicy?.[chainId]?.authorization,
      observed: data?.observedAuthorizationByChain[chainId],
    })
    const allMessagesAllowed = authorization
      ? validateAutoSignMessages(authorization, messages).valid
      : messages.every((msg) => {
          const chainMessageTypes = messageTypes[chainId]
          if (!chainMessageTypes) return false
          return (
            isAutoSignMessageTypeAllowed(msg.typeUrl) && chainMessageTypes.includes(msg.typeUrl)
          )
        })

    // Check condition 2: status must be current and the on-chain permission
    // must not have expired since its last successful read.
    const isAutoSignEnabled = isAutoSignStatusEnabledAndFresh({
      status: data,
      dataUpdatedAt,
      chainId,
    })
    const matchesExpectedGrantee =
      !expectedGrantee || data?.granteeByChain[chainId] === expectedGrantee

    return allMessagesAllowed && isAutoSignEnabled && matchesExpectedGrantee
  })
}

/* Get current AutoSign status including enabled state and expiration dates by chain */
export function useAutoSignStatus() {
  const initiaAddress = useInitiaAddress()
  const config = useConfig()
  const messageTypes = useAutoSignMessageTypes()
  const messageTypesKey = createAutoSignMessageTypesKey(messageTypes)
  const { fetchFeegrant, fetchAllGrants } = useAutoSignApi()
  const chains = useInitiaRegistry()
  const networkKey = createAutoSignNetworkKey(config.registryUrl, chains, Object.keys(messageTypes))
  const { getActiveIdentity, getWalletIdentities } = useDeriveWallet()
  const authorizationPolicies = Object.fromEntries(
    Object.entries(config.autoSignGrantPolicy ?? {}).map(([chainId, policy]) => [
      chainId,
      policy.authorization,
    ]),
  )
  const authorizationPoliciesKey = createAuthorizationPoliciesKey({
    ...authorizationPolicies,
    // Fee-budget configuration changes the allowance the signer must honor;
    // include it so a previous network/policy snapshot cannot remain active.
    ...Object.fromEntries(
      Object.entries(config.autoSignGrantPolicy ?? {}).map(([chainId, policy]) => [
        `${chainId}:fee-budget`,
        policy.feeBudget,
      ]),
    ),
  })

  return useQuery({
    // Query identity follows user/address + configured message types, not function references.
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    queryKey: autoSignQueryKeys.expirations(
      initiaAddress,
      messageTypesKey,
      messageTypes,
      authorizationPoliciesKey,
      networkKey,
    ).queryKey,
    queryFn: () =>
      fetchAutoSignStatus({
        initiaAddress,
        messageTypes,
        authorizationPolicies,
        fetchActiveIdentity: getActiveIdentity,
        fetchKnownIdentity: async (chainId) =>
          (await getWalletIdentities(chainId)).find(
            (identity) => identity.state === "active" || identity.state === "paused",
          ),
        fetchAllGrants,
        fetchFeegrant,
      }),
    staleTime: STALE_TIMES.MINUTE,
    refetchInterval: AUTO_SIGN_STATUS_MAX_AGE_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 1,
  })
}

export async function fetchAutoSignStatus(
  params: FetchAutoSignStatusParams,
): Promise<AutoSignStatusResult> {
  const {
    initiaAddress,
    messageTypes,
    authorizationPolicies,
    fetchActiveIdentity,
    fetchKnownIdentity,
    fetchAllGrants,
    fetchFeegrant,
  } = params

  if (!initiaAddress) {
    return {
      expiredAtByChain: {},
      feegrantByChain: {},
      isEnabledByChain: {},
      granteeByChain: {},
      requestedDurationInMsByChain: {},
      observedAuthorizationByChain: {},
      statusByChain: {},
    }
  }

  const expiredAtByChain: Record<string, Date | null | undefined> = {}
  const feegrantByChain: Record<string, FeegrantAllowance | undefined> = {}
  const granteeByChain: Record<string, string | undefined> = {}
  const isEnabledByChain: Record<string, boolean> = {}
  const statusByChain: Record<string, AutoSignChainStatus> = {}
  const requestedDurationInMsByChain: Record<string, number | undefined> = {}
  const observedAuthorizationByChain: Record<string, AutoSignPermissionPolicy | undefined> = {}
  const expectedAddressByChain: Record<string, string | null | undefined> = {}
  const chainEntriesToValidate: Array<[string, string[]]> = []

  for (const [chainId, msgTypes] of Object.entries(messageTypes)) {
    // Empty type lists can never enable autosign; mark disabled without querying grants.
    expiredAtByChain[chainId] = null
    feegrantByChain[chainId] = undefined
    granteeByChain[chainId] = undefined
    isEnabledByChain[chainId] = false
    requestedDurationInMsByChain[chainId] = undefined
    observedAuthorizationByChain[chainId] = undefined
    statusByChain[chainId] = "disabled"

    if (msgTypes.length > 0) {
      chainEntriesToValidate.push([chainId, msgTypes])
    }
  }

  if (chainEntriesToValidate.length === 0) {
    return {
      expiredAtByChain,
      feegrantByChain,
      isEnabledByChain,
      granteeByChain,
      requestedDurationInMsByChain,
      observedAuthorizationByChain,
      statusByChain,
    }
  }

  const chainResults = await mapWithConcurrency(
    chainEntriesToValidate,
    CHAIN_STATUS_CONCURRENCY,
    async ([chainId, msgTypes]) => {
      // A confirmed persistent random identity is authoritative over the
      // legacy mirror. Without either identity, status must not adopt an
      // arbitrary on-chain grantee for signing.
      let activeIdentity: Awaited<ReturnType<NonNullable<typeof fetchActiveIdentity>>>
      let identityMetadata: Awaited<ReturnType<NonNullable<typeof fetchKnownIdentity>>>
      const withIdentity = (
        result: Omit<AutoSignChainStatusResult, "requestedDurationMs">,
      ): AutoSignChainStatusResult => ({
        ...result,
        requestedDurationMs: identityMetadata?.requestedDurationMs,
      })
      try {
        // Storage access is optional capability discovery. A blocked or
        // unavailable IndexedDB must degrade this chain to unknown rather
        // than reject the complete status query.
        activeIdentity = await fetchActiveIdentity?.(chainId)
        identityMetadata = activeIdentity ?? (await fetchKnownIdentity?.(chainId))
        const expectedAddress =
          activeIdentity?.address ?? getExpectedAddress(initiaAddress, chainId)
        const allGrants = await fetchAllGrants(chainId)
        const grantsToCheck = expectedAddress
          ? allGrants.filter((grant) => grant.grantee === expectedAddress)
          : []
        const validGranteeCandidates = authorizationPolicies?.[chainId]
          ? findValidPolicyGranteeCandidates(grantsToCheck, authorizationPolicies[chainId]!)
          : findValidGranteeCandidates(grantsToCheck, msgTypes)

        if (validGranteeCandidates.length === 0) {
          const policy = authorizationPolicies?.[chainId]
          const broadGrant =
            policy && policy.kind !== "generic" ? findActiveGenericGrant(grantsToCheck) : undefined
          if (broadGrant) {
            return withIdentity({
              chainId,
              expectedAddress,
              expiration: broadGrant.expiration ? new Date(broadGrant.expiration) : undefined,
              grantee: broadGrant.grantee,
              status: "needs-permission-update" as const,
            })
          }
          const expiredGrantee = authorizationPolicies?.[chainId]
            ? findExpiredPolicyGrantee(grantsToCheck, authorizationPolicies[chainId]!)
            : findExpiredGrantee(grantsToCheck, msgTypes)
          if (expiredGrantee) {
            return withIdentity({
              chainId,
              expectedAddress,
              expiration: expiredGrantee.expiration,
              grantee: expiredGrantee.grantee,
              status: "expired" as const,
            })
          }
          const storedExpired = await getStoredExpiredIdentity(chainId, fetchActiveIdentity)
          if (storedExpired) {
            return withIdentity({
              chainId,
              expectedAddress,
              expiration: storedExpired.expiration,
              grantee: storedExpired.grantee,
              status: "expired" as const,
            })
          }
          return withIdentity({
            chainId,
            expectedAddress,
            expiration: null,
            grantee: undefined as string | undefined,
            status: "disabled" as const,
          })
        }

        const validGrantee = await findValidGranteeWithFeegrant({
          chainId,
          candidates: validGranteeCandidates,
          fetchFeegrant,
          concurrency: FEEGRANT_CANDIDATE_CONCURRENCY,
        })
        if (!validGrantee) {
          const storedExpired = await getStoredExpiredIdentity(chainId, fetchActiveIdentity)
          if (storedExpired) {
            return withIdentity({
              chainId,
              expectedAddress,
              expiration: storedExpired.expiration,
              grantee: storedExpired.grantee,
              status: "expired" as const,
            })
          }
          return withIdentity({
            chainId,
            expectedAddress,
            expiration: null,
            grantee: undefined as string | undefined,
            status: "disabled" as const,
          })
        }

        // `validGrantee` already contains only the authorizations that prove
        // the configured scope. Typed authz authorizations have no `msg`
        // field, so filtering by message type here would silently omit their
        // expiry and could keep a finite typed grant displayed as permanent.
        const grantExpirations = validGrantee.grantee.grants.map((grant) => grant.expiration)
        const feegrantExpiration = getFeegrantExpiration(validGrantee.feegrant.allowance)
        const allExpirations = [...grantExpirations, feegrantExpiration]
        const earliestExpiration = findEarliestDate(allExpirations)
        const hasBroaderGenericGrant =
          authorizationPolicies?.[chainId]?.kind === "generic" &&
          hasActiveGenericGrantOutsideScope(
            grantsToCheck.filter((grant) => grant.grantee === validGrantee.grantee.grantee),
            authorizationPolicies[chainId].messageTypes,
          )

        return withIdentity({
          chainId,
          expectedAddress,
          expiration: earliestExpiration ? new Date(earliestExpiration) : undefined,
          grantee: validGrantee.grantee.grantee,
          status: hasBroaderGenericGrant
            ? ("needs-permission-update" as const)
            : ("enabled" as const),
          feegrant: validGrantee.feegrant,
          observedAuthorization:
            authorizationPolicies?.[chainId]?.kind === "wasm"
              ? observedAuthorizationToPermissionPolicy(
                  parseObservedAuthorization(validGrantee.grantee.grants[0]!),
                )
              : undefined,
        })
      } catch {
        return withIdentity({
          chainId,
          expectedAddress: undefined,
          expiration: undefined,
          grantee: undefined as string | undefined,
          status: "unknown" as const,
        })
      }
    },
  )

  for (const result of chainResults) {
    expectedAddressByChain[result.chainId] = result.expectedAddress
    expiredAtByChain[result.chainId] = result.expiration
    feegrantByChain[result.chainId] = result.feegrant
    granteeByChain[result.chainId] = result.grantee
    requestedDurationInMsByChain[result.chainId] = result.requestedDurationMs
    observedAuthorizationByChain[result.chainId] = result.observedAuthorization
    statusByChain[result.chainId] = result.status
  }

  for (const [chainId] of chainEntriesToValidate) {
    isEnabledByChain[chainId] =
      statusByChain[chainId] === "enabled" &&
      resolveAutoSignEnabledForChain({
        expiration: expiredAtByChain[chainId],
        grantee: granteeByChain[chainId],
        expectedAddress: expectedAddressByChain[chainId],
      })
  }

  return {
    expiredAtByChain,
    feegrantByChain,
    isEnabledByChain,
    granteeByChain,
    requestedDurationInMsByChain,
    observedAuthorizationByChain,
    statusByChain,
  }
}

async function getStoredExpiredIdentity(
  chainId: string,
  fetchActiveIdentity: FetchAutoSignStatusParams["fetchActiveIdentity"],
): Promise<{ grantee: string; expiration: Date } | undefined> {
  if (!fetchActiveIdentity) return undefined
  const identity = await fetchActiveIdentity(chainId)
  if (!identity?.observedExpiration) return undefined
  const expiration = new Date(identity.observedExpiration)
  return !Number.isNaN(expiration.getTime()) && !isFuture(expiration)
    ? { grantee: identity.address, expiration }
    : undefined
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
  grants: Array<{ authorization: { "@type"?: string; msg?: string }; expiration?: string }>
}

export function isFeegrantEligibleForAutoSign(feegrant: FeegrantAllowance): boolean {
  const allowance = feegrant.allowance
  const isBasic = allowance["@type"] === "/cosmos.feegrant.v1beta1.BasicAllowance"
  const isAllowedBasic =
    allowance["@type"] === "/cosmos.feegrant.v1beta1.AllowedMsgAllowance" &&
    allowance.allowance?.["@type"] === "/cosmos.feegrant.v1beta1.BasicAllowance"
  if (!isBasic && !isAllowedBasic) return false

  const feegrantAllowedMessages = getFeegrantAllowedMessages(allowance)
  const allowsAuthzExec =
    isBasic ||
    (Array.isArray(feegrantAllowedMessages) &&
      feegrantAllowedMessages.includes("/cosmos.authz.v1beta1.MsgExec"))
  if (!allowsAuthzExec) {
    return false
  }

  const spendLimit = getFeegrantSpendLimit(allowance)
  if (
    spendLimit?.length &&
    !spendLimit.every((coin) => !!coin.denom && /^[1-9][0-9]*$/.test(coin.amount))
  ) {
    return false
  }

  const expiration = getFeegrantExpiration(allowance)
  if (!expiration) return true
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
  allGrants: Array<{
    grantee: string
    authorization: { "@type"?: string; msg?: string }
    expiration?: string
  }>,
  requiredMsgTypes: string[],
): GrantWithGrantee[] {
  if (requiredMsgTypes.length === 0) {
    return []
  }

  const grantsByGrantee = new Map<
    string,
    Array<{ authorization: { "@type"?: string; msg?: string }; expiration?: string }>
  >()

  for (const grant of allGrants) {
    const existing = grantsByGrantee.get(grant.grantee) || []
    existing.push({ authorization: grant.authorization, expiration: grant.expiration })
    grantsByGrantee.set(grant.grantee, existing)
  }

  const candidates: GrantWithGrantee[] = []
  for (const [grantee, grants] of grantsByGrantee) {
    const validGrants = grants.filter(
      (grant) =>
        (!grant.authorization["@type"] ||
          grant.authorization["@type"] === "/cosmos.authz.v1beta1.GenericAuthorization") &&
        !!grant.authorization.msg &&
        isAutoSignMessageTypeAllowed(grant.authorization.msg) &&
        (!grant.expiration || isFuture(new Date(grant.expiration))),
    )
    const grantedMsgTypes = validGrants.flatMap((grant) =>
      grant.authorization.msg ? [grant.authorization.msg] : [],
    )
    const hasAllTypes = requiredMsgTypes.every((msgType) => grantedMsgTypes.includes(msgType))
    if (hasAllTypes) {
      candidates.push({ grantee, grants: validGrants })
    }
  }

  return candidates
}

export function findValidPolicyGranteeCandidates(
  allGrants: Array<{
    grantee: string
    authorization: { "@type"?: string; msg?: string }
    expiration?: string
  }>,
  policy: AutoSignPermissionPolicy,
): GrantWithGrantee[] {
  if (policy.kind === "generic") return findValidGranteeCandidates(allGrants, policy.messageTypes)

  const matchingByGrantee = new Map<string, GrantWithGrantee["grants"]>()
  for (const grant of allGrants) {
    if (grant.expiration && !isFuture(new Date(grant.expiration))) continue
    if (!doesObservedAuthorizationMatchPolicy(grant, policy)) continue
    matchingByGrantee.set(grant.grantee, [...(matchingByGrantee.get(grant.grantee) ?? []), grant])
  }
  return [...matchingByGrantee].map(([grantee, grants]) => ({ grantee, grants }))
}

function findExpiredGrantee(
  grants: Array<{
    grantee: string
    authorization: { "@type"?: string; msg?: string }
    expiration?: string
  }>,
  requiredMessageTypes: string[],
): { grantee: string; expiration: Date } | undefined {
  const byGrantee = new Map<string, typeof grants>()
  for (const grant of grants)
    byGrantee.set(grant.grantee, [...(byGrantee.get(grant.grantee) ?? []), grant])
  for (const [grantee, candidateGrants] of byGrantee) {
    const matching = candidateGrants.filter(
      (grant) =>
        (!grant.authorization["@type"] ||
          grant.authorization["@type"] === "/cosmos.authz.v1beta1.GenericAuthorization") &&
        !!grant.authorization.msg &&
        requiredMessageTypes.includes(grant.authorization.msg),
    )
    const expired = matching
      .map((grant) => grant.expiration && new Date(grant.expiration))
      .filter((date): date is Date => !!date && !Number.isNaN(date.getTime()) && !isFuture(date))
    if (
      expired.length &&
      requiredMessageTypes.every((type) =>
        matching.some((grant) => grant.authorization.msg === type),
      )
    ) {
      return { grantee, expiration: findEarliestDate(expired)! }
    }
  }
  return undefined
}

function findExpiredPolicyGrantee(
  grants: Array<{
    grantee: string
    authorization: { "@type"?: string; msg?: string }
    expiration?: string
  }>,
  policy: AutoSignPermissionPolicy,
): { grantee: string; expiration: Date } | undefined {
  for (const grant of grants) {
    if (!doesObservedAuthorizationMatchPolicy(grant, policy) || !grant.expiration) continue
    const expiration = new Date(grant.expiration)
    if (!Number.isNaN(expiration.getTime()) && !isFuture(expiration)) {
      return { grantee: grant.grantee, expiration }
    }
  }
  return undefined
}

function findActiveGenericGrant(
  grants: Array<{
    grantee: string
    authorization: { "@type"?: string; msg?: string }
    expiration?: string
  }>,
) {
  return grants.find(
    (grant) =>
      (!grant.authorization["@type"] ||
        grant.authorization["@type"] === "/cosmos.authz.v1beta1.GenericAuthorization") &&
      !!grant.authorization.msg &&
      (!grant.expiration || isFuture(new Date(grant.expiration))),
  )
}

function hasActiveGenericGrantOutsideScope(
  grants: Array<{
    authorization: { "@type"?: string; msg?: string }
    expiration?: string
  }>,
  messageTypes: string[],
) {
  return grants.some(
    (grant) =>
      (!grant.authorization["@type"] ||
        grant.authorization["@type"] === "/cosmos.authz.v1beta1.GenericAuthorization") &&
      !!grant.authorization.msg &&
      !messageTypes.includes(grant.authorization.msg) &&
      (!grant.expiration || isFuture(new Date(grant.expiration))),
  )
}

export function resolveAutoSignEnabledForChain(params: {
  expiration: Date | null | undefined
  grantee?: string
  expectedAddress?: string | null | undefined
}): boolean {
  const { expiration, grantee, expectedAddress } = params
  const addressMatches =
    expectedAddress === undefined ? !!grantee : !!grantee && expectedAddress === grantee

  switch (expiration) {
    case null:
      return false
    case undefined:
      return addressMatches
    default:
      return addressMatches && isFuture(expiration)
  }
}

export function canActivatePendingAutoSignIdentity(params: {
  status: AutoSignChainStatus | undefined
  matchedGrantee: string | undefined
  pendingAddress: string
}): boolean {
  return params.status === "enabled" && params.matchedGrantee === params.pendingAddress
}

/**
 * Recovers the narrow window where the owner transaction reached the chain but
 * the browser reloaded before a pending random key could be promoted. This
 * never creates or replaces a key: it promotes only the exact pending public
 * identity after its full configured grant and fee allowance are observed.
 */
export function useReconcilePendingAutoSign() {
  const initiaAddress = useInitiaAddress()
  const config = useConfig()
  const messageTypes = useAutoSignMessageTypes()
  const messageTypesKey = createAutoSignMessageTypesKey(messageTypes)
  const { fetchAllGrants, fetchFeegrant } = useAutoSignApi()
  const { activatePendingIdentity, getPendingIdentities } = useDeriveWallet()
  const queryClient = useQueryClient()
  const { dataUpdatedAt: statusUpdatedAt } = useAutoSignStatus()
  const authorizationPolicies = Object.fromEntries(
    Object.entries(config.autoSignGrantPolicy ?? {}).map(([chainId, policy]) => [
      chainId,
      policy.authorization,
    ]),
  )
  const authorizationPoliciesKey = createAuthorizationPoliciesKey(authorizationPolicies)
  const reconcile = useEffectEvent(async () => {
    if (!initiaAddress) return
    await withAutoSignOperation(initiaAddress, async () => {
      for (const [chainId, configuredTypes] of Object.entries(messageTypes)) {
        if (!configuredTypes.length) continue
        const pendingIdentities = await getPendingIdentities(chainId)
        for (const pendingIdentity of pendingIdentities) {
          const status = await fetchAutoSignStatus({
            initiaAddress,
            messageTypes: { [chainId]: configuredTypes },
            authorizationPolicies: { [chainId]: authorizationPolicies[chainId] },
            fetchActiveIdentity: async () => pendingIdentity,
            fetchAllGrants,
            fetchFeegrant,
          })
          if (
            !canActivatePendingAutoSignIdentity({
              status: status.statusByChain[chainId],
              matchedGrantee: status.granteeByChain[chainId],
              pendingAddress: pendingIdentity.address,
            })
          ) {
            continue
          }
          await activatePendingIdentity(chainId, pendingIdentity.keyId)
          await queryClient.invalidateQueries({ queryKey: autoSignQueryKeys.expirations._def })
        }
      }
    })
  })

  useEffect(() => {
    void reconcile().catch(() => {
      // A storage or network failure leaves the candidate pending for the next
      // startup. It must never turn into a resubmission or replacement.
    })
  }, [initiaAddress, messageTypesKey, authorizationPoliciesKey, statusUpdatedAt])
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
