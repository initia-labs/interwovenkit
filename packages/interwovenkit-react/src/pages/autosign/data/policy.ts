import { sortedJsonStringify } from "@cosmjs/amino/build/signdoc"
import { fromBase64 } from "@cosmjs/encoding"
import type { EncodeObject } from "@cosmjs/proto-signing"
import type { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin"
import { getAddress } from "viem"
import { GenericAuthorization } from "@initia/initia.proto/cosmos/authz/v1beta1/authz"
import {
  AcceptedMessageKeysFilter,
  AcceptedMessagesFilter,
  AllowAllMessagesFilter,
  CombinedLimit,
  ContractExecutionAuthorization,
  MaxCallsLimit,
  MaxFundsLimit,
} from "@initia/initia.proto/cosmwasm/wasm/v1/authz"
import { Any } from "@initia/initia.proto/google/protobuf/any"
import { ExecuteAuthorization } from "@initia/initia.proto/initia/move/v1/authz"
import { CallAuthorization } from "@initia/initia.proto/minievm/evm/v1/authz"

export const GENERIC_AUTHORIZATION_TYPE = "/cosmos.authz.v1beta1.GenericAuthorization"
export const MOVE_EXECUTE_AUTHORIZATION_TYPE = "/initia.move.v1.ExecuteAuthorization"
export const EVM_CALL_AUTHORIZATION_TYPE = "/minievm.evm.v1.CallAuthorization"
export const WASM_EXECUTE_AUTHORIZATION_TYPE = "/cosmwasm.wasm.v1.ContractExecutionAuthorization"
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
export type WasmMessageFilterPolicy =
  | { kind: "allow-all" }
  | { kind: "accepted-message-keys"; keys: string[] }
  | { kind: "accepted-messages"; messages: string[] }
export type WasmLimitPolicy =
  | { kind: "max-calls"; remaining: bigint }
  | { kind: "max-funds"; amounts: Coin[] }
  | { kind: "combined"; callsRemaining: bigint; amounts: Coin[] }
export interface WasmPermissionPolicy {
  kind: "wasm"
  grants: Array<{ contract: string; filter: WasmMessageFilterPolicy; limit: WasmLimitPolicy }>
}
export type AutoSignPermissionPolicy =
  | GenericPermissionPolicy
  | MovePermissionPolicy
  | EvmPermissionPolicy
  | WasmPermissionPolicy

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
function asAny(typeUrl: string, value: Uint8Array) {
  return Any.fromPartial({ typeUrl, value })
}
/** Cosmos Amino writes RawContractMessage as inline JSON. Canonicalize at each
 * boundary so whitespace or object-key order cannot change an exact permission. */
export function canonicalizeWasmAcceptedMessage(message: unknown): string {
  try {
    const parsed = typeof message === "string" ? (JSON.parse(message) as unknown) : message
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Object.getPrototypeOf(parsed) !== Object.prototype
    )
      throw new Error()
    return sortedJsonStringify(parsed as Record<string, unknown>)
  } catch {
    throw new Error("AutoSign Wasm accepted messages must be JSON objects")
  }
}
function canonicalizeWasmAcceptedMessages(messages: unknown): string[] | undefined {
  if (!Array.isArray(messages)) return undefined
  try {
    return messages.map(canonicalizeWasmAcceptedMessage)
  } catch {
    return undefined
  }
}

function validateCoins(coins: Coin[], label: string) {
  if (!coins.length || coins.some((coin) => !coin.denom || !/^[1-9][0-9]*$/.test(coin.amount))) {
    throw new Error(`AutoSign ${label} must use positive base-unit coins`)
  }
}
function encodeFilter(filter: WasmMessageFilterPolicy) {
  switch (filter.kind) {
    case "allow-all":
      return asAny(
        "/cosmwasm.wasm.v1.AllowAllMessagesFilter",
        AllowAllMessagesFilter.encode({}).finish(),
      )
    case "accepted-message-keys":
      assertNonEmpty(filter.keys, "Wasm filter keys")
      return asAny(
        "/cosmwasm.wasm.v1.AcceptedMessageKeysFilter",
        AcceptedMessageKeysFilter.encode({ keys: [...new Set(filter.keys)] }).finish(),
      )
    case "accepted-messages": {
      assertNonEmpty(filter.messages, "Wasm accepted messages")
      const messages = canonicalizeWasmAcceptedMessages(filter.messages)
      if (!messages) throw new Error("AutoSign Wasm accepted messages must be JSON objects")
      return asAny(
        "/cosmwasm.wasm.v1.AcceptedMessagesFilter",
        AcceptedMessagesFilter.encode({
          messages: [...new Set(messages)].map((message) => new TextEncoder().encode(message)),
        }).finish(),
      )
    }
  }
}
function encodeLimit(limit: WasmLimitPolicy) {
  switch (limit.kind) {
    case "max-calls":
      if (limit.remaining <= 0n) throw new Error("AutoSign Wasm max-calls must be positive")
      return asAny(
        "/cosmwasm.wasm.v1.MaxCallsLimit",
        MaxCallsLimit.encode({ remaining: limit.remaining }).finish(),
      )
    case "max-funds":
      validateCoins(limit.amounts, "Wasm max-funds")
      return asAny(
        "/cosmwasm.wasm.v1.MaxFundsLimit",
        MaxFundsLimit.encode({ amounts: limit.amounts }).finish(),
      )
    case "combined":
      if (limit.callsRemaining <= 0n)
        throw new Error("AutoSign Wasm combined calls must be positive")
      validateCoins(limit.amounts, "Wasm combined funds")
      return asAny(
        "/cosmwasm.wasm.v1.CombinedLimit",
        CombinedLimit.encode({
          callsRemaining: limit.callsRemaining,
          amounts: limit.amounts,
        }).finish(),
      )
  }
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
    case "wasm": {
      if (!policy.grants.length || policy.grants.some((grant) => !grant.contract))
        throw new Error("AutoSign Wasm permissions require explicit contract grants")
      if (new Set(policy.grants.map((grant) => grant.contract)).size !== policy.grants.length)
        throw new Error("AutoSign Wasm permissions cannot repeat a contract")
      return [
        {
          typeUrl: WASM_EXECUTE_AUTHORIZATION_TYPE,
          value: ContractExecutionAuthorization.encode({
            grants: policy.grants.map((grant) => ({
              contract: grant.contract,
              filter: encodeFilter(grant.filter),
              limit: encodeLimit(grant.limit),
            })),
          }).finish(),
          messageType: WASM_EXECUTE_MESSAGE_TYPE,
          enforcement: "on-chain",
          description: `Wasm: ${policy.grants.map((grant) => grant.contract).join(", ")}`,
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
  if (policy.kind === "evm") {
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
  const value = message.value as { contract?: string; msg?: Uint8Array }
  const grant = policy.grants.find((candidate) => candidate.contract === value.contract)
  if (message.typeUrl !== WASM_EXECUTE_MESSAGE_TYPE || !grant || !value.msg)
    return {
      valid: false,
      enforcement: "on-chain",
      reason: "Wasm contract is outside the configured scope",
    }
  const raw = new TextDecoder().decode(value.msg)
  const filter = grant.filter
  switch (filter.kind) {
    case "allow-all":
      return { valid: true, enforcement: "on-chain" }
    case "accepted-messages": {
      let canonical: string
      try {
        canonical = canonicalizeWasmAcceptedMessage(raw)
      } catch {
        return { valid: false, enforcement: "on-chain", reason: "Wasm message is not valid JSON" }
      }
      const accepted = canonicalizeWasmAcceptedMessages(filter.messages)
      return accepted?.includes(canonical)
        ? { valid: true, enforcement: "on-chain" }
        : {
            valid: false,
            enforcement: "on-chain",
            reason: "Wasm message is outside the configured filter",
          }
    }
    case "accepted-message-keys":
      try {
        const parsed = JSON.parse(raw) as unknown
        const isPlainObject =
          !!parsed &&
          typeof parsed === "object" &&
          !Array.isArray(parsed) &&
          Object.getPrototypeOf(parsed) === Object.prototype
        const keys = isPlainObject ? Object.keys(parsed) : []
        return keys.length === 1 && filter.keys.includes(keys[0]!)
          ? { valid: true, enforcement: "on-chain" }
          : {
              valid: false,
              enforcement: "on-chain",
              reason: "Wasm message must contain exactly one allowed top-level key",
            }
      } catch {
        return { valid: false, enforcement: "on-chain", reason: "Wasm message is not valid JSON" }
      }
  }
}

/** Validates an immutable transaction batch, including Wasm call/fund limits. */
export function validateAutoSignMessages(
  policy: AutoSignPermissionPolicy,
  messages: readonly EncodeObject[],
): PermissionValidationResult {
  const firstFailure = messages
    .map((message) => validateAutoSignMessage(policy, message))
    .find((result) => !result.valid)
  if (firstFailure) return firstFailure
  if (policy.kind !== "wasm") {
    return {
      valid: true,
      enforcement: policy.kind === "evm" && policy.selectors?.length ? "sdk-only" : "on-chain",
    }
  }
  const calls = new Map<string, { count: bigint; funds: Map<string, bigint> }>()
  for (const message of messages) {
    const value = message.value as {
      contract?: string
      funds?: Array<{ denom: string; amount: string }>
    }
    if (!value.contract)
      return { valid: false, enforcement: "on-chain", reason: "Wasm call has no contract" }
    const total = calls.get(value.contract) ?? { count: 0n, funds: new Map<string, bigint>() }
    total.count += 1n
    for (const coin of value.funds ?? []) {
      if (!coin.denom || !/^[1-9][0-9]*$/.test(coin.amount))
        return {
          valid: false,
          enforcement: "on-chain",
          reason: "Wasm funds must use positive base-unit coins",
        }
      try {
        total.funds.set(coin.denom, (total.funds.get(coin.denom) ?? 0n) + BigInt(coin.amount))
      } catch {
        return { valid: false, enforcement: "on-chain", reason: "Wasm funds are invalid" }
      }
    }
    calls.set(value.contract, total)
  }
  for (const grant of policy.grants) {
    const total = calls.get(grant.contract)
    if (!total) continue
    const limit = grant.limit
    const callsRemaining =
      limit.kind === "max-calls"
        ? limit.remaining
        : limit.kind === "combined"
          ? limit.callsRemaining
          : undefined
    const amounts =
      limit.kind === "max-funds" ? limit.amounts : limit.kind === "combined" ? limit.amounts : []
    if (callsRemaining !== undefined && total.count > callsRemaining)
      return {
        valid: false,
        enforcement: "on-chain",
        reason: "Wasm batch exceeds the configured call limit",
      }
    for (const [denom, amount] of total.funds) {
      const maximum = amounts.find((coin) => coin.denom === denom)
      if (!maximum || amount > BigInt(maximum.amount))
        return {
          valid: false,
          enforcement: "on-chain",
          reason: "Wasm batch exceeds the configured funds limit",
        }
    }
    if (limit.kind === "max-calls" && total.funds.size)
      return {
        valid: false,
        enforcement: "on-chain",
        reason: "Wasm max-calls grants do not allow attached funds",
      }
  }
  return { valid: true, enforcement: "on-chain" }
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
      case WASM_EXECUTE_AUTHORIZATION_TYPE:
        return parseObservedAuthorization({
          authorization: {
            "@type": typeUrl,
            ...(ContractExecutionAuthorization.toJSON(
              ContractExecutionAuthorization.decode(value),
            ) as Record<string, unknown>),
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
    case "wasm": {
      const grants = Array.isArray(scope.value.grants) ? scope.value.grants : []
      return grants.map((grant) => {
        const record = grant as Record<string, unknown>
        const filter = unpackWasmFilter(record.filter)
        const limit = unpackWasmLimit(record.limit)
        const filterDetail = filter ? JSON.stringify(filter) : "unknown filter"
        const limitDetail = limit ? JSON.stringify(limit) : "unknown limit"
        return `Wasm ${String(record.contract)}; filter ${filterDetail}; limit ${limitDetail}`
      })
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
    case WASM_EXECUTE_AUTHORIZATION_TYPE:
      return {
        kind: "wasm",
        typeUrl,
        messageType: WASM_EXECUTE_MESSAGE_TYPE,
        value: {
          grants: Array.isArray(raw.grants)
            ? raw.grants.map((grant) => {
                const record = grant as Record<string, unknown>
                return {
                  contract: record.contract,
                  filter: normalizeObservedWasmAny(record.filter),
                  limit: normalizeObservedWasmAny(record.limit),
                }
              })
            : [],
        },
      }
    default:
      return { kind: "unknown", typeUrl, value: raw }
  }
}

/** The REST gateway emits json_name fields and nested Any values in `@type`
 * form, unlike ts-proto's camelCase-only fromJSON helpers. */
function normalizeObservedWasmAny(value: unknown): unknown {
  if (!value || typeof value !== "object") return value
  const record = value as Record<string, unknown>
  if (typeof record["@type"] !== "string") return value
  return {
    ...record,
    callsRemaining: record.callsRemaining ?? record.calls_remaining,
  }
}

/** Converts a decoded on-chain scope to an exact runtime policy. This is used
 * for observed Wasm limits, whose remaining values can be lower than configured. */
export function observedAuthorizationToPermissionPolicy(
  scope: ObservedAuthorizationScope,
): AutoSignPermissionPolicy | undefined {
  if (scope.kind !== "wasm") return undefined
  const grants = Array.isArray(scope.value.grants) ? scope.value.grants : []
  const exactGrants: WasmPermissionPolicy["grants"] = []
  for (const grant of grants) {
    if (!grant || typeof grant !== "object") return undefined
    const record = grant as Record<string, unknown>
    if (typeof record.contract !== "string" || !record.contract) return undefined
    const filter = unpackWasmFilter(record.filter)
    const limit = unpackWasmLimit(record.limit)
    const exactFilter = observedWasmFilterToPolicy(filter)
    const exactLimit = observedWasmLimitToPolicy(limit)
    if (!exactFilter || !exactLimit) return undefined
    exactGrants.push({ contract: record.contract, filter: exactFilter, limit: exactLimit })
  }
  return exactGrants.length ? { kind: "wasm", grants: exactGrants } : undefined
}

function observedWasmFilterToPolicy(
  filter: Record<string, unknown> | undefined,
): WasmMessageFilterPolicy | undefined {
  switch (filter?.["@type"]) {
    case "/cosmwasm.wasm.v1.AllowAllMessagesFilter":
      return { kind: "allow-all" }
    case "/cosmwasm.wasm.v1.AcceptedMessageKeysFilter":
      return Array.isArray(filter.keys) && filter.keys.every((key) => typeof key === "string")
        ? { kind: "accepted-message-keys", keys: filter.keys }
        : undefined
    case "/cosmwasm.wasm.v1.AcceptedMessagesFilter": {
      const messages = canonicalizeWasmAcceptedMessages(filter.messages)
      return messages ? { kind: "accepted-messages", messages } : undefined
    }
    default:
      return undefined
  }
}
function observedWasmLimitToPolicy(
  limit: Record<string, unknown> | undefined,
): WasmLimitPolicy | undefined {
  const amounts = Array.isArray(limit?.amounts)
    ? (limit.amounts as Coin[]).filter(
        (coin) => !!coin && typeof coin.denom === "string" && typeof coin.amount === "string",
      )
    : undefined
  try {
    switch (limit?.["@type"]) {
      case "/cosmwasm.wasm.v1.MaxCallsLimit":
        return { kind: "max-calls", remaining: BigInt(limit.remaining as string) }
      case "/cosmwasm.wasm.v1.MaxFundsLimit":
        return amounts ? { kind: "max-funds", amounts } : undefined
      case "/cosmwasm.wasm.v1.CombinedLimit":
        return amounts
          ? { kind: "combined", callsRemaining: BigInt(limit.callsRemaining as string), amounts }
          : undefined
      default:
        return undefined
    }
  } catch {
    return undefined
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
  if (policy.kind === "evm")
    return sameNormalizedEvmAddressSet(observed.value.contracts, policy.contracts)
  const grants = observed.value.grants
  return (
    Array.isArray(grants) &&
    grants.length > 0 &&
    grants.length <= policy.grants.length &&
    new Set(
      grants.map((grant) =>
        grant && typeof grant === "object"
          ? String((grant as Record<string, unknown>).contract)
          : "",
      ),
    ).size === grants.length &&
    grants.every((grant) => {
      if (!grant || typeof grant !== "object") return false
      const observedGrant = grant as Record<string, unknown>
      const expected = policy.grants.find(
        (candidate) => candidate.contract === observedGrant.contract,
      )
      return (
        !!expected &&
        matchesWasmFilter(observedGrant.filter, expected.filter) &&
        matchesWasmLimit(observedGrant.limit, expected.limit)
      )
    })
  )
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
function matchesWasmFilter(value: unknown, expected: WasmMessageFilterPolicy) {
  const filter = unpackWasmFilter(value)
  if (!filter) return false
  switch (expected.kind) {
    case "allow-all":
      return filter["@type"] === "/cosmwasm.wasm.v1.AllowAllMessagesFilter"
    case "accepted-message-keys":
      return (
        filter["@type"] === "/cosmwasm.wasm.v1.AcceptedMessageKeysFilter" &&
        sameStringSet(filter.keys, expected.keys)
      )
    case "accepted-messages": {
      const observed = canonicalizeWasmAcceptedMessages(filter.messages)
      const configured = canonicalizeWasmAcceptedMessages(expected.messages)
      return !!observed && !!configured && sameStringSet(observed, configured)
    }
  }
}
function matchesWasmLimit(value: unknown, expected: WasmLimitPolicy) {
  const limit = unpackWasmLimit(value)
  if (!limit) return false
  if (expected.kind === "max-calls")
    return (
      limit["@type"] === "/cosmwasm.wasm.v1.MaxCallsLimit" &&
      nonNegativeAtMost(limit.remaining, expected.remaining)
    )
  if (expected.kind === "max-funds")
    return (
      limit["@type"] === "/cosmwasm.wasm.v1.MaxFundsLimit" &&
      coinsAtMost(limit.amounts, expected.amounts)
    )
  return (
    limit["@type"] === "/cosmwasm.wasm.v1.CombinedLimit" &&
    nonNegativeAtMost(limit.callsRemaining, expected.callsRemaining) &&
    coinsAtMost(limit.amounts, expected.amounts)
  )
}
function unpackWasmFilter(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined
  const any = value as Record<string, unknown>
  if (typeof any["@type"] === "string") return any
  if (typeof any.typeUrl !== "string" || typeof any.value !== "string") return undefined
  try {
    const bytes = fromBase64(any.value)
    switch (any.typeUrl) {
      case "/cosmwasm.wasm.v1.AllowAllMessagesFilter":
        AllowAllMessagesFilter.decode(bytes)
        return { "@type": any.typeUrl }
      case "/cosmwasm.wasm.v1.AcceptedMessageKeysFilter":
        return {
          "@type": any.typeUrl,
          ...(AcceptedMessageKeysFilter.toJSON(AcceptedMessageKeysFilter.decode(bytes)) as Record<
            string,
            unknown
          >),
        }
      case "/cosmwasm.wasm.v1.AcceptedMessagesFilter":
        return {
          "@type": any.typeUrl,
          messages: AcceptedMessagesFilter.decode(bytes).messages.map((message) =>
            new TextDecoder().decode(message),
          ),
        }
      default:
        return undefined
    }
  } catch {
    return undefined
  }
}
function unpackWasmLimit(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined
  const any = value as Record<string, unknown>
  if (typeof any["@type"] === "string") return any
  if (typeof any.typeUrl !== "string" || typeof any.value !== "string") return undefined
  try {
    const bytes = fromBase64(any.value)
    switch (any.typeUrl) {
      case "/cosmwasm.wasm.v1.MaxCallsLimit":
        return {
          "@type": any.typeUrl,
          ...(MaxCallsLimit.toJSON(MaxCallsLimit.decode(bytes)) as Record<string, unknown>),
        }
      case "/cosmwasm.wasm.v1.MaxFundsLimit":
        return {
          "@type": any.typeUrl,
          ...(MaxFundsLimit.toJSON(MaxFundsLimit.decode(bytes)) as Record<string, unknown>),
        }
      case "/cosmwasm.wasm.v1.CombinedLimit":
        return {
          "@type": any.typeUrl,
          ...(CombinedLimit.toJSON(CombinedLimit.decode(bytes)) as Record<string, unknown>),
        }
      default:
        return undefined
    }
  } catch {
    return undefined
  }
}
function nonNegativeAtMost(value: unknown, maximum: bigint) {
  try {
    const current = BigInt(value as string)
    return current >= 0n && current <= maximum
  } catch {
    return false
  }
}
function coinsAtMost(value: unknown, maximums: Coin[]) {
  if (!Array.isArray(value)) return false
  const observedDenoms = new Set<string>()
  return value.every((coin) => {
    if (!coin || typeof coin !== "object") return false
    const current = coin as { denom?: string; amount?: string }
    if (
      !current.denom ||
      observedDenoms.has(current.denom) ||
      typeof current.amount !== "string" ||
      !/^(?:0|[1-9][0-9]*)$/.test(current.amount)
    )
      return false
    observedDenoms.add(current.denom)
    const maximum = maximums.find((candidate) => candidate.denom === current.denom)
    return !!maximum && nonNegativeAtMost(current.amount, BigInt(maximum.amount))
  })
}
