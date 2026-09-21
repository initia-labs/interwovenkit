import type { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin"
import type { FeegrantAllowance, Grant } from "./fetch"
import { getFeegrantAllowedMessages, getFeegrantExpiration, getFeegrantSpendLimit } from "./fetch"
import {
  describeObservedAuthorization,
  getRevokeMessageType,
  type ObservedAuthorizationScope,
  parseObservedAuthorization,
} from "./policy"

export type GrantAttribution = "local-current" | "locally-known" | "unattributed"
export type FeeAllowanceStatus =
  | { kind: "missing" }
  | { kind: "unknown" }
  | { kind: "unlimited"; expiration?: Date }
  | { kind: "limited"; expiration?: Date; spendLimit: Coin[]; remainingObserved: Coin[] }

export interface GrantAuthorizationInventory {
  typeUrl: string
  messageType?: string
  expiration?: Date
  known: boolean
  revocable: boolean
  /** Exact normalized chain authorization, preserved for scoped-permission UI. */
  observed: ObservedAuthorizationScope
  description: string[]
}

export interface GrantInventoryItem {
  chainId: string
  grantee: string
  expiration?: Date
  authorizations: GrantAuthorizationInventory[]
  attribution: GrantAttribution
  feeAllowance: FeeAllowanceStatus
  /** Only these exact underlying message types may appear in MsgRevoke. */
  revocableMessageTypes: string[]
  canRevoke: boolean
  revokeReason?: string
}

/**
 * Local lifetime metadata is retained after a finite grant has expired so the
 * user can reconnect the same signer. It never represents an active chain
 * permission and is only added when the chain inventory has no entry for it.
 */
export interface ExpiredLocalGrantIdentity {
  grantee: string
  expiration: Date
}

function validDate(value: string | undefined) {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}
function earliest(dates: Array<Date | undefined>) {
  return dates.reduce<Date | undefined>(
    (result, value) => (!value || (result && result <= value) ? result : value),
    undefined,
  )
}
export function getAutoSignFeeAllowanceStatus(
  feegrant: FeegrantAllowance | undefined,
  availability: "available" | "unknown" = "available",
): FeeAllowanceStatus {
  if (!feegrant) return availability === "unknown" ? { kind: "unknown" } : { kind: "missing" }
  const allowance = feegrant.allowance
  const isBasic = allowance["@type"] === "/cosmos.feegrant.v1beta1.BasicAllowance"
  const isAllowedBasic =
    allowance["@type"] === "/cosmos.feegrant.v1beta1.AllowedMsgAllowance" &&
    allowance.allowance?.["@type"] === "/cosmos.feegrant.v1beta1.BasicAllowance"
  if (!isBasic && !isAllowedBasic) return { kind: "unknown" }

  const allowed = getFeegrantAllowedMessages(allowance)
  if (allowed && !allowed.includes("/cosmos.authz.v1beta1.MsgExec")) return { kind: "unknown" }
  const expiration = validDate(getFeegrantExpiration(allowance))
  const spendLimit = getFeegrantSpendLimit(allowance)
  return spendLimit?.length
    ? { kind: "limited", expiration, spendLimit, remainingObserved: spendLimit }
    : { kind: "unlimited", expiration }
}

/** Builds an honest management view without inferring app ownership from message type. */
export function buildAutoSignGrantInventory(params: {
  chainId: string
  grants: Grant[]
  feegrants?: FeegrantAllowance[]
  /** An unavailable issued-allowance endpoint must not masquerade as no allowance. */
  feegrantsAvailability?: "available" | "unknown"
  currentGrantee?: string
  knownGrantees?: Iterable<string>
  expiredLocalIdentity?: ExpiredLocalGrantIdentity
}): GrantInventoryItem[] {
  const grouped = new Map<string, Grant[]>()
  const feegrants = new Map(params.feegrants?.map((feegrant) => [feegrant.grantee, feegrant]))
  const known = new Set(params.knownGrantees)
  for (const grant of params.grants)
    grouped.set(grant.grantee, [...(grouped.get(grant.grantee) ?? []), grant])
  for (const grantee of feegrants.keys()) if (!grouped.has(grantee)) grouped.set(grantee, [])
  const expiredLocalIdentity =
    params.expiredLocalIdentity &&
    params.feegrantsAvailability !== "unknown" &&
    !grouped.has(params.expiredLocalIdentity.grantee) &&
    !Number.isNaN(params.expiredLocalIdentity.expiration.getTime())
      ? params.expiredLocalIdentity
      : undefined
  if (expiredLocalIdentity) grouped.set(expiredLocalIdentity.grantee, [])

  return [...grouped].map(([grantee, grants]) => {
    const isExpiredLocalIdentity = grantee === expiredLocalIdentity?.grantee
    const authorizations = grants.map((grant) => {
      const observed = parseObservedAuthorization(grant)
      const messageType = getRevokeMessageType(grant)
      return {
        typeUrl: observed.typeUrl,
        messageType,
        expiration: validDate(grant.expiration),
        known: observed.kind !== "unknown",
        revocable: !!messageType,
        observed,
        description: describeObservedAuthorization(observed),
      }
    })
    const revocableMessageTypes = [
      ...new Set(
        authorizations.flatMap((authorization) =>
          authorization.messageType ? [authorization.messageType] : [],
        ),
      ),
    ]
    const feeAllowance = getAutoSignFeeAllowanceStatus(
      feegrants.get(grantee),
      params.feegrantsAvailability,
    )
    const canRevoke =
      !isExpiredLocalIdentity && (!!revocableMessageTypes.length || feeAllowance.kind !== "missing")
    const unknown = authorizations.some((authorization) => !authorization.known)
    return {
      chainId: params.chainId,
      grantee,
      expiration: isExpiredLocalIdentity
        ? expiredLocalIdentity.expiration
        : earliest([
            ...authorizations.map((authorization) => authorization.expiration),
            "expiration" in feeAllowance ? feeAllowance.expiration : undefined,
          ]),
      authorizations,
      attribution:
        grantee === params.currentGrantee
          ? "local-current"
          : known.has(grantee)
            ? "locally-known"
            : "unattributed",
      feeAllowance,
      revocableMessageTypes,
      canRevoke,
      revokeReason: !canRevoke
        ? isExpiredLocalIdentity
          ? "This expired approval is no longer present on chain"
          : unknown
            ? "Unknown authorization type cannot be safely revoked"
            : "No revocable approval found"
        : undefined,
    }
  })
}
