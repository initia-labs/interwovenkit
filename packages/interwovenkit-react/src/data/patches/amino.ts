import type { AminoConverter, AminoConverters } from "@cosmjs/stargate"
import { aminoConverters as baseAminoConverters } from "@initia/amino-converter"
import { AllowedMsgAllowance } from "@initia/initia.proto/cosmos/feegrant/v1beta1/feegrant"
import type { MsgGrantAllowance } from "@initia/initia.proto/cosmos/feegrant/v1beta1/tx"

const MSG_GRANT_ALLOWANCE_TYPE_URL = "/cosmos.feegrant.v1beta1.MsgGrantAllowance"
const ALLOWED_MSG_ALLOWANCE_TYPE_URL = "/cosmos.feegrant.v1beta1.AllowedMsgAllowance"
const ALLOWED_MSG_ALLOWANCE_AMINO_TYPE = "cosmos-sdk/AllowedMsgAllowance"

type ProtoAllowance = {
  typeUrl: string
  value: Uint8Array
}

type AminoAllowance = {
  type: string
  value: Record<string, unknown>
}

function getRequiredMsgGrantAllowanceConverter(): AminoConverter {
  const converter = baseAminoConverters[MSG_GRANT_ALLOWANCE_TYPE_URL] as AminoConverter | undefined
  if (!converter) {
    throw new Error("Missing base converter for MsgGrantAllowance")
  }
  return converter
}

const baseMsgGrantAllowanceConverter = getRequiredMsgGrantAllowanceConverter()

function toAminoAllowance(allowance: ProtoAllowance): AminoAllowance {
  if (allowance.typeUrl === ALLOWED_MSG_ALLOWANCE_TYPE_URL) {
    const decoded = AllowedMsgAllowance.decode(allowance.value)
    if (!decoded.allowance) {
      throw new Error("AllowedMsgAllowance is missing nested allowance")
    }

    return {
      type: ALLOWED_MSG_ALLOWANCE_AMINO_TYPE,
      value: {
        allowance: toAminoAllowance(decoded.allowance as ProtoAllowance),
        allowed_messages: decoded.allowedMessages,
      },
    }
  }

  // Reuse the upstream MsgGrantAllowance conversion for non-Allowed allowances
  // to avoid duplicating handling for Basic/Periodic/etc. allowance types.
  return (
    baseMsgGrantAllowanceConverter.toAmino({
      granter: "",
      grantee: "",
      allowance,
    } as MsgGrantAllowance) as { allowance: AminoAllowance }
  ).allowance
}

function fromAminoAllowance(allowance: AminoAllowance): ProtoAllowance {
  if (allowance.type === ALLOWED_MSG_ALLOWANCE_AMINO_TYPE) {
    const value = allowance.value as {
      allowance?: AminoAllowance
      allowed_messages?: string[]
      allowedMessages?: string[]
    }

    if (!value.allowance) {
      throw new Error("AllowedMsgAllowance amino value is missing nested allowance")
    }

    const nestedAllowance = fromAminoAllowance(value.allowance)
    return {
      typeUrl: ALLOWED_MSG_ALLOWANCE_TYPE_URL,
      value: AllowedMsgAllowance.encode(
        AllowedMsgAllowance.fromPartial({
          allowance: nestedAllowance,
          allowedMessages: value.allowed_messages ?? value.allowedMessages ?? [],
        }),
      ).finish(),
    }
  }

  // Convert through MsgGrantAllowance to preserve upstream parsing behavior
  // for all non-Allowed allowance types.
  return (
    baseMsgGrantAllowanceConverter.fromAmino({
      granter: "",
      grantee: "",
      allowance,
    }) as MsgGrantAllowance
  ).allowance as ProtoAllowance
}

export const patchedAminoConverters: AminoConverters = {
  ...baseAminoConverters,
  [MSG_GRANT_ALLOWANCE_TYPE_URL]: {
    ...baseMsgGrantAllowanceConverter,
    toAmino: (msg: MsgGrantAllowance) => {
      if (!msg.allowance) {
        return baseMsgGrantAllowanceConverter.toAmino(msg)
      }

      return {
        granter: msg.granter,
        grantee: msg.grantee,
        allowance: toAminoAllowance(msg.allowance as ProtoAllowance),
      }
    },
    fromAmino: (msg: {
      granter: string
      grantee: string
      allowance: AminoAllowance
    }): MsgGrantAllowance => ({
      granter: msg.granter,
      grantee: msg.grantee,
      allowance: fromAminoAllowance(msg.allowance),
    }),
  },
}
