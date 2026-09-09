import { sortedJsonStringify } from "@cosmjs/amino/build/signdoc"
import { fromBase64, fromUtf8, toBase64, toUtf8 } from "@cosmjs/encoding"
import type { AminoConverter } from "@cosmjs/stargate"
import { aminoConverters } from "@initia/amino-converter"
import { MsgGrant } from "@initia/initia.proto/cosmos/authz/v1beta1/tx"
import { ExecuteAuthorization } from "@initia/initia.proto/initia/move/v1/authz"
import { CallAuthorization } from "@initia/initia.proto/minievm/evm/v1/authz"

const MOVE_AUTHORIZATION = "/initia.move.v1.ExecuteAuthorization"
const EVM_AUTHORIZATION = "/minievm.evm.v1.CallAuthorization"
const WASM_AUTHORIZATION = "/cosmwasm.wasm.v1.ContractExecutionAuthorization"
const UPSTREAM_WASM_AUTHORIZATION = "/initia.wasm.v1.ContractExecutionAuthorization"
const base = aminoConverters["/cosmos.authz.v1beta1.MsgGrant"]!

/** Match Go's RFC3339Nano formatting without changing the represented instant. */
export function formatAminoExpiration(expiration: Date | string | undefined): string | undefined {
  if (!expiration) return undefined
  const iso = typeof expiration === "string" ? expiration : expiration.toISOString()
  return iso.replace(/(\.\d*?[1-9])0+Z$/, "$1Z").replace(/\.0+Z$/, "Z")
}

interface AminoAuthorization {
  type: string
  value: {
    contracts?: string[]
    items?: Array<{ module_address: string; module_name: string; function_names: string[] }>
    grants?: Array<{
      contract: string
      limit: { type: string; value: Record<string, unknown> }
      filter: { type: string; value: { messages?: unknown[] } }
    }>
  }
}
interface AminoGrant {
  granter: string
  grantee: string
  grant: { authorization: AminoAuthorization; expiration?: string }
}

/** The upstream converter uses base64 where wasmd requires inline JSON. */
function mapAcceptedMessages(msg: AminoGrant, map: (message: unknown) => unknown): AminoGrant {
  const authorization = msg.grant.authorization
  if (authorization.type !== "wasm/ContractExecutionAuthorization") return msg
  return {
    ...msg,
    grant: {
      ...msg.grant,
      authorization: {
        ...authorization,
        value: {
          ...authorization.value,
          grants: authorization.value.grants?.map((grant) =>
            grant.filter.type === "wasm/AcceptedMessagesFilter"
              ? {
                  ...grant,
                  filter: {
                    ...grant.filter,
                    value: { messages: grant.filter.value.messages?.map(map) },
                  },
                }
              : grant,
          ),
        },
      },
    },
  }
}

/** Narrow compatibility fixes for typed grants missing from amino-converter 1.0.19. */
export const typedMsgGrantAminoConverter: AminoConverter = {
  ...base,
  toAmino: (msg: MsgGrant): AminoGrant => {
    const authorization = msg.grant?.authorization
    if (authorization?.typeUrl === MOVE_AUTHORIZATION) {
      return {
        granter: msg.granter,
        grantee: msg.grantee,
        grant: {
          authorization: {
            type: "move/ExecuteAuthorization",
            value: {
              items: ExecuteAuthorization.decode(authorization.value).items.map((item) => ({
                module_address: item.moduleAddress,
                module_name: item.moduleName,
                function_names: item.functionNames,
              })),
            },
          },
          expiration: formatAminoExpiration(msg.grant?.expiration),
        },
      }
    }
    if (authorization?.typeUrl === EVM_AUTHORIZATION) {
      return {
        granter: msg.granter,
        grantee: msg.grantee,
        grant: {
          authorization: {
            type: "evm/CallAuthorization",
            value: { contracts: CallAuthorization.decode(authorization.value).contracts },
          },
          expiration: formatAminoExpiration(msg.grant?.expiration),
        },
      }
    }
    const amino = base.toAmino(
      authorization?.typeUrl === WASM_AUTHORIZATION
        ? {
            ...msg,
            grant: {
              ...msg.grant,
              authorization: { ...authorization, typeUrl: UPSTREAM_WASM_AUTHORIZATION },
            },
          }
        : msg,
    ) as AminoGrant
    amino.grant.expiration = formatAminoExpiration(amino.grant.expiration)
    return mapAcceptedMessages(amino, (message) =>
      JSON.parse(fromUtf8(fromBase64(String(message)))),
    )
  },
  fromAmino: (msg: AminoGrant): MsgGrant => {
    const authorization = msg.grant.authorization
    if (authorization.type === "move/ExecuteAuthorization") {
      return MsgGrant.fromPartial({
        granter: msg.granter,
        grantee: msg.grantee,
        grant: {
          authorization: {
            typeUrl: MOVE_AUTHORIZATION,
            value: ExecuteAuthorization.encode({
              items: (authorization.value.items ?? []).map((item) => ({
                moduleAddress: item.module_address,
                moduleName: item.module_name,
                functionNames: item.function_names,
              })),
            }).finish(),
          },
          expiration: msg.grant.expiration ? new Date(msg.grant.expiration) : undefined,
        },
      })
    }
    if (authorization.type === "evm/CallAuthorization") {
      return MsgGrant.fromPartial({
        granter: msg.granter,
        grantee: msg.grantee,
        grant: {
          authorization: {
            typeUrl: EVM_AUTHORIZATION,
            value: CallAuthorization.encode(
              CallAuthorization.fromJSON(authorization.value),
            ).finish(),
          },
          expiration: msg.grant.expiration ? new Date(msg.grant.expiration) : undefined,
        },
      })
    }
    const converted = base.fromAmino(
      mapAcceptedMessages(msg, (message) => toBase64(toUtf8(sortedJsonStringify(message)))),
    ) as MsgGrant
    if (converted.grant?.authorization?.typeUrl === UPSTREAM_WASM_AUTHORIZATION) {
      converted.grant.authorization.typeUrl = WASM_AUTHORIZATION
    }
    return converted
  },
}
