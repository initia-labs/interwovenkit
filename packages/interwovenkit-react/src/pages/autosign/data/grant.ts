import { MsgGrant } from "@initia/initia.proto/cosmos/authz/v1beta1/tx"
import {
  AllowedMsgAllowance,
  BasicAllowance,
} from "@initia/initia.proto/cosmos/feegrant/v1beta1/feegrant"
import { MsgGrantAllowance } from "@initia/initia.proto/cosmos/feegrant/v1beta1/tx"
import {
  assertAutoSignMessageTypesAllowed,
  type AutoSignPermissionPolicy,
  encodeAutoSignAuthorizations,
} from "./policy"

export const AUTHZ_EXEC_MESSAGE_TYPE = "/cosmos.authz.v1beta1.MsgExec"

export interface BuildAutoSignGrantMessagesParams {
  granter: string
  grantee: string
  messageTypes: string[]
  authorization?: AutoSignPermissionPolicy
  expiration?: Date
}

export interface AutoSignGrantMessage {
  typeUrl: string
  value: MsgGrant | MsgGrantAllowance
}

export function buildAutoSignGrantMessages(
  params: BuildAutoSignGrantMessagesParams,
): AutoSignGrantMessage[] {
  const { granter, grantee, messageTypes, authorization, expiration } = params
  const uniqueMessageTypes = [...new Set(messageTypes)]
  assertAutoSignMessageTypesAllowed(uniqueMessageTypes)
  const basicAllowance = {
    typeUrl: "/cosmos.feegrant.v1beta1.BasicAllowance",
    value: BasicAllowance.encode(BasicAllowance.fromPartial({ expiration })).finish(),
  }
  const feegrantMessage: AutoSignGrantMessage = {
    typeUrl: "/cosmos.feegrant.v1beta1.MsgGrantAllowance",
    value: MsgGrantAllowance.fromPartial({
      granter,
      grantee,
      allowance: {
        typeUrl: "/cosmos.feegrant.v1beta1.AllowedMsgAllowance",
        value: AllowedMsgAllowance.encode(
          AllowedMsgAllowance.fromPartial({
            allowance: basicAllowance,
            allowedMessages: [AUTHZ_EXEC_MESSAGE_TYPE],
          }),
        ).finish(),
      },
    }),
  }

  const encodedAuthorizations = encodeAutoSignAuthorizations(
    authorization ?? { kind: "generic", messageTypes: uniqueMessageTypes },
  )
  const authzMessages: AutoSignGrantMessage[] = encodedAuthorizations.map((authorization) => ({
    typeUrl: "/cosmos.authz.v1beta1.MsgGrant",
    value: MsgGrant.fromPartial({
      granter,
      grantee,
      grant: {
        authorization: {
          typeUrl: authorization.typeUrl,
          value: authorization.value,
        },
        expiration,
      },
    }),
  }))

  return [feegrantMessage, ...authzMessages]
}
