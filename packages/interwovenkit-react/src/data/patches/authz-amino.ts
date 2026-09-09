import type { AminoConverter } from "@cosmjs/stargate"
import { aminoConverters } from "@initia/amino-converter"
import { MsgGrant } from "@initia/initia.proto/cosmos/authz/v1beta1/tx"
import { ExecuteAuthorization } from "@initia/initia.proto/initia/move/v1/authz"
import { CallAuthorization } from "@initia/initia.proto/minievm/evm/v1/authz"

const MOVE_AUTHORIZATION = "/initia.move.v1.ExecuteAuthorization"
const EVM_AUTHORIZATION = "/minievm.evm.v1.CallAuthorization"
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
  }
}
interface AminoGrant {
  granter: string
  grantee: string
  grant: { authorization: AminoAuthorization; expiration?: string }
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
    const amino = base.toAmino(msg) as AminoGrant
    amino.grant.expiration = formatAminoExpiration(amino.grant.expiration)
    return amino
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
    return base.fromAmino(msg) as MsgGrant
  },
}
