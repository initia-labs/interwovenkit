import type { EncodeObject } from "@cosmjs/proto-signing"
import { getAddress } from "viem"
import { GenericAuthorization } from "@initia/initia.proto/cosmos/authz/v1beta1/authz"
import { ExecuteAuthorization } from "@initia/initia.proto/initia/move/v1/authz"
import { CallAuthorization } from "@initia/initia.proto/minievm/evm/v1/authz"

export const GENERIC_AUTHORIZATION_TYPE = "/cosmos.authz.v1beta1.GenericAuthorization"
export const MOVE_EXECUTE_AUTHORIZATION_TYPE = "/initia.move.v1.ExecuteAuthorization"
export const EVM_CALL_AUTHORIZATION_TYPE = "/minievm.evm.v1.CallAuthorization"
export const MOVE_EXECUTE_MESSAGE_TYPE = "/initia.move.v1.MsgExecute"
export const EVM_CALL_MESSAGE_TYPE = "/minievm.evm.v1.MsgCall"
export const WASM_EXECUTE_MESSAGE_TYPE = "/cosmwasm.wasm.v1.MsgExecuteContract"

export const AUTOSIGN_DENIED_MESSAGE_TYPES = new Set([
  "/cosmos.authz.v1beta1.MsgGrant",
  "/cosmos.authz.v1beta1.MsgRevoke",
  "/cosmos.authz.v1beta1.MsgExec",
  "/cosmos.feegrant.v1beta1.MsgGrantAllowance",
  "/cosmos.feegrant.v1beta1.MsgRevokeAllowance",
])

export type AutoSignPolicyEnforcement = "on-chain" | "sdk-only" | "unsupported"
export interface GenericPermissionPolicy {
  kind: "generic"
  messageTypes: string[]
}
export interface MovePermissionPolicy {
  kind: "move"
  items: Array<{ moduleAddress: string; moduleName: string; functionNames: string[] }>
}
export interface EvmPermissionPolicy {
  kind: "evm"
  contracts: string[]
  /** Four-byte selector validation is SDK-only; chain authz only restricts targets. */
  selectors?: string[]
}
export type AutoSignPermissionPolicy =
  | GenericPermissionPolicy
  | MovePermissionPolicy
  | EvmPermissionPolicy

export interface EncodedAuthorization {
  typeUrl: string
  value: Uint8Array
  messageType: string
  enforcement: AutoSignPolicyEnforcement
  description: string
}
export interface PermissionValidationResult {
  valid: boolean
  enforcement: AutoSignPolicyEnforcement
  reason?: string
}
export interface ObservedAuthorizationScope {
  kind: AutoSignPermissionPolicy["kind"] | "unknown"
  typeUrl: string
  messageType?: string
  value: Record<string, unknown>
}

export function isAutoSignMessageTypeAllowed(messageType: string): boolean {
  return !!messageType && !AUTOSIGN_DENIED_MESSAGE_TYPES.has(messageType)
}

export function assertAutoSignMessageTypesAllowed(messageTypes: readonly string[]): void {
  const denied = messageTypes.filter((type) => !isAutoSignMessageTypeAllowed(type))
  if (denied.length)
    throw new Error(`AutoSign cannot delegate permission-management messages: ${denied.join(", ")}`)
}

function assertNonEmpty(values: readonly string[], label: string) {
  if (!values.length || values.some((value) => !value))
    throw new Error(`AutoSign ${label} must be explicit and non-empty`)
}
function isMoveIdentifier(value: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
}
function normalizeEvmAddress(value: string) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value))
    throw new Error("AutoSign EVM targets must be 20-byte hex addresses")
  // MiniEVM validates checksummed Ethereum addresses in CallAuthorization.
  return getAddress(value)
}
/** Typed policies are fail-closed: they never silently become a broad GenericAuthorization. */
export function encodeAutoSignAuthorizations(
  policy: AutoSignPermissionPolicy,
): EncodedAuthorization[] {
  switch (policy.kind) {
    case "generic": {
      const messageTypes = [...new Set(policy.messageTypes)]
      assertNonEmpty(messageTypes, "generic message types")
      assertAutoSignMessageTypesAllowed(messageTypes)
      return messageTypes.map((messageType) => ({
        typeUrl: GENERIC_AUTHORIZATION_TYPE,
        value: GenericAuthorization.encode({ msg: messageType }).finish(),
        messageType,
        enforcement: "on-chain" as const,
        description: `Any ${messageType}`,
      }))
    }
    case "move": {
      if (
        !policy.items.length ||
        policy.items.some(
          (item) =>
            !/^0x[0-9a-fA-F]+$/.test(item.moduleAddress) ||
            !isMoveIdentifier(item.moduleName) ||
            !item.functionNames.length ||
            item.functionNames.some((functionName) => !isMoveIdentifier(functionName)),
        )
      )
        throw new Error("AutoSign Move permissions require exact modules and functions")
      if (
        new Set(policy.items.map((item) => `${item.moduleAddress}:${item.moduleName}`)).size !==
        policy.items.length
      )
        throw new Error("AutoSign Move permissions cannot repeat a module")
      return [
        {
          typeUrl: MOVE_EXECUTE_AUTHORIZATION_TYPE,
          value: ExecuteAuthorization.encode({
            items: policy.items.map((item) => ({
              ...item,
              functionNames: [...new Set(item.functionNames)],
            })),
          }).finish(),
          messageType: MOVE_EXECUTE_MESSAGE_TYPE,
          enforcement: "on-chain",
          description: `Move: ${policy.items.map((item) => `${item.moduleAddress}::${item.moduleName}`).join(", ")}`,
        },
      ]
    }
    case "evm": {
      assertNonEmpty(policy.contracts, "EVM contracts")
      const contracts = [...new Set(policy.contracts.map(normalizeEvmAddress))]
      if (policy.selectors?.some((selector) => !/^0x[0-9a-fA-F]{8}$/.test(selector)))
        throw new Error("AutoSign EVM selectors must be four-byte hex values")
      return [
        {
          typeUrl: EVM_CALL_AUTHORIZATION_TYPE,
          value: CallAuthorization.encode({ contracts }).finish(),
          messageType: EVM_CALL_MESSAGE_TYPE,
          enforcement: policy.selectors?.length ? "sdk-only" : "on-chain",
          description: `EVM: ${contracts.join(", ")}`,
        },
      ]
    }
  }
}

export function validateAutoSignMessage(
  policy: AutoSignPermissionPolicy,
  message: EncodeObject,
): PermissionValidationResult {
  if (policy.kind === "generic")
    return policy.messageTypes.includes(message.typeUrl) &&
      isAutoSignMessageTypeAllowed(message.typeUrl)
      ? { valid: true, enforcement: "on-chain" }
      : { valid: false, enforcement: "on-chain", reason: "Message is outside the configured scope" }
  if (policy.kind === "move") {
    const value = message.value as {
      moduleAddress?: string
      moduleName?: string
      functionName?: string
    }
    const valid =
      message.typeUrl === MOVE_EXECUTE_MESSAGE_TYPE &&
      policy.items.some(
        (item) =>
          item.moduleAddress === value.moduleAddress &&
          item.moduleName === value.moduleName &&
          !!value.functionName &&
          item.functionNames.includes(value.functionName),
      )
    return valid
      ? { valid: true, enforcement: "on-chain" }
      : {
          valid: false,
          enforcement: "on-chain",
          reason: "Move call is outside the configured scope",
        }
  }
  const value = message.value as { contractAddr?: string; input?: string }
  let contractAllowed = false
  try {
    contractAllowed =
      message.typeUrl === EVM_CALL_MESSAGE_TYPE &&
      !!value.contractAddr &&
      policy.contracts.map(normalizeEvmAddress).includes(normalizeEvmAddress(value.contractAddr))
  } catch {
    contractAllowed = false
  }
  if (!contractAllowed)
    return {
      valid: false,
      enforcement: "on-chain",
      reason: "EVM target is outside the configured scope",
    }
  if (!policy.selectors?.length) return { valid: true, enforcement: "on-chain" }
  if (!value.input || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value.input))
    return { valid: false, enforcement: "sdk-only", reason: "EVM input is not hex calldata" }
  const selector = value.input.slice(0, 10).toLowerCase()
  return selector && policy.selectors.some((allowed) => allowed.toLowerCase() === selector)
    ? { valid: true, enforcement: "sdk-only" }
    : {
        valid: false,
        enforcement: "sdk-only",
        reason: "EVM selector is outside the SDK-only scope",
      }
}

/** Validates an immutable transaction batch. */
export function validateAutoSignMessages(
  policy: AutoSignPermissionPolicy,
  messages: readonly EncodeObject[],
): PermissionValidationResult {
  const firstFailure = messages
    .map((message) => validateAutoSignMessage(policy, message))
    .find((result) => !result.valid)
  if (firstFailure) return firstFailure
  return {
    valid: true,
    enforcement: policy.kind === "evm" && policy.selectors?.length ? "sdk-only" : "on-chain",
  }
}

type GrantAuthorizationInput = {
  authorization: { "@type"?: string; msg?: string; [key: string]: unknown }
}

export function parseObservedAuthorizationAny(params: {
  typeUrl: string
  value: Uint8Array
}): ObservedAuthorizationScope {
  const { typeUrl, value } = params
  try {
    switch (typeUrl) {
      case GENERIC_AUTHORIZATION_TYPE:
        return parseObservedAuthorization({
          authorization: {
            "@type": typeUrl,
            ...(GenericAuthorization.toJSON(GenericAuthorization.decode(value)) as Record<
              string,
              unknown
            >),
          },
        })
      case MOVE_EXECUTE_AUTHORIZATION_TYPE:
        return parseObservedAuthorization({
          authorization: {
            "@type": typeUrl,
            ...(ExecuteAuthorization.toJSON(ExecuteAuthorization.decode(value)) as Record<
              string,
              unknown
            >),
          },
        })
      case EVM_CALL_AUTHORIZATION_TYPE:
        return parseObservedAuthorization({
          authorization: {
            "@type": typeUrl,
            ...(CallAuthorization.toJSON(CallAuthorization.decode(value)) as Record<
              string,
              unknown
            >),
          },
        })
      default:
        return { kind: "unknown", typeUrl, value: {} }
    }
  } catch {
    return { kind: "unknown", typeUrl, value: {} }
  }
}

/** Human-readable, lossless-enough summary for management and approval UI. */
export function describeObservedAuthorization(scope: ObservedAuthorizationScope): string[] {
  switch (scope.kind) {
    case "generic":
      return scope.messageType ? [`Any ${scope.messageType}`] : ["Generic authorization"]
    case "move": {
      const items = Array.isArray(scope.value.items) ? scope.value.items : []
      return items.map((item) => {
        const record = item as Record<string, unknown>
        const functions = Array.isArray(record.functionNames)
          ? record.functionNames
              .filter((value): value is string => typeof value === "string")
              .join(", ")
          : ""
        return `Move ${String(record.moduleAddress)}::${String(record.moduleName)}${
          functions ? `::${functions}` : ""
        }`
      })
    }
    case "evm": {
      const contracts = Array.isArray(scope.value.contracts) ? scope.value.contracts : []
      return contracts.map((contract) => `EVM contract ${String(contract)}`)
    }
    case "unknown":
      return [`Unknown permission (${scope.typeUrl})`]
  }
}

export function parseObservedAuthorization(
  grant: GrantAuthorizationInput,
): ObservedAuthorizationScope {
  const typeUrl = grant.authorization["@type"] ?? "unknown"
  const raw = grant.authorization
  switch (typeUrl) {
    case GENERIC_AUTHORIZATION_TYPE:
      return { kind: "generic", typeUrl, messageType: raw.msg, value: raw }
    case MOVE_EXECUTE_AUTHORIZATION_TYPE:
      return {
        kind: "move",
        typeUrl,
        messageType: MOVE_EXECUTE_MESSAGE_TYPE,
        value: {
          items: Array.isArray(raw.items)
            ? raw.items.map((item) => {
                const record = item as Record<string, unknown>
                return {
                  moduleAddress: record.moduleAddress ?? record.module_address,
                  moduleName: record.moduleName ?? record.module_name,
                  functionNames: record.functionNames ?? record.function_names,
                }
              })
            : [],
        },
      }
    case EVM_CALL_AUTHORIZATION_TYPE:
      return {
        kind: "evm",
        typeUrl,
        messageType: EVM_CALL_MESSAGE_TYPE,
        value: { contracts: Array.isArray(raw.contracts) ? raw.contracts : [] },
      }
    default:
      return { kind: "unknown", typeUrl, value: raw }
  }
}

/** MsgRevoke takes the delegated message type, not the authorization Any type. */
export function getRevokeMessageType(grant: GrantAuthorizationInput): string | undefined {
  return parseObservedAuthorization(grant).messageType
}

/** Never accept a broad generic grant as proof of a requested typed restriction. */
export function doesObservedAuthorizationMatchPolicy(
  grant: GrantAuthorizationInput,
  policy: AutoSignPermissionPolicy,
): boolean {
  const observed = parseObservedAuthorization(grant)
  if (observed.kind !== policy.kind) return false
  if (policy.kind === "generic")
    return (
      !!observed.messageType &&
      isAutoSignMessageTypeAllowed(observed.messageType) &&
      policy.messageTypes.includes(observed.messageType)
    )
  if (policy.kind === "move") {
    const items = observed.value.items
    return sameMoveItemSet(items, policy.items)
  }
  return sameNormalizedEvmAddressSet(observed.value.contracts, policy.contracts)
}
function sameMoveItemSet(value: unknown, expected: MovePermissionPolicy["items"]): boolean {
  if (!Array.isArray(value) || value.length !== expected.length) return false
  const observedKeys = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== "object") return false
    const record = item as Record<string, unknown>
    const moduleAddress = record.moduleAddress
    const moduleName = record.moduleName
    if (typeof moduleAddress !== "string" || typeof moduleName !== "string") return false
    const key = `${moduleAddress}:${moduleName}`
    if (observedKeys.has(key)) return false
    observedKeys.add(key)
    const matchingExpected = expected.find(
      (candidate) =>
        candidate.moduleAddress === moduleAddress &&
        candidate.moduleName === moduleName &&
        sameStringSet(record.functionNames, candidate.functionNames),
    )
    if (!matchingExpected) return false
  }
  return true
}
function sameStringSet(value: unknown, expected: readonly string[]) {
  return (
    Array.isArray(value) &&
    value.length === new Set(expected).size &&
    value.length === new Set(value).size &&
    value.every((item) => typeof item === "string" && expected.includes(item))
  )
}
function sameNormalizedEvmAddressSet(value: unknown, expected: readonly string[]) {
  if (!Array.isArray(value)) return false
  try {
    const actual = value.map((item) => normalizeEvmAddress(String(item)))
    const normalizedExpected = expected.map(normalizeEvmAddress)
    return sameStringSet(actual, normalizedExpected)
  } catch {
    return false
  }
}
