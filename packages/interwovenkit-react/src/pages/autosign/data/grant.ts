import type { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin"
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

export interface AutoSignFeeBudget {
  /** Base-unit coin amounts. Omit to intentionally grant an unlimited allowance. */
  spendLimit?: Coin[]
}

export interface BuildAutoSignGrantMessagesParams {
  granter: string
  grantee: string
  messageTypes: string[]
  authorization?: AutoSignPermissionPolicy
  expiration?: Date
  feeBudget?: AutoSignFeeBudget
}

export interface AutoSignGrantMessage {
  typeUrl: string
  value: MsgGrant | MsgGrantAllowance
}

export function buildAutoSignFeegrantMessage(params: {
  granter: string
  grantee: string
  expiration?: Date
  feeBudget?: AutoSignFeeBudget
}): AutoSignGrantMessage {
  const { granter, grantee, expiration, feeBudget } = params
  validateAutoSignFeeBudget(feeBudget)
  const basicAllowance = {
    typeUrl: "/cosmos.feegrant.v1beta1.BasicAllowance",
    value: BasicAllowance.encode(
      BasicAllowance.fromPartial({ expiration, spendLimit: feeBudget?.spendLimit }),
    ).finish(),
  }

  return {
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
}

export function validateAutoSignFeeBudget(feeBudget: AutoSignFeeBudget | undefined): void {
  if (!feeBudget?.spendLimit) return

  const seenDenoms = new Set<string>()
  for (const coin of feeBudget.spendLimit) {
    if (!coin.denom || !/^[1-9][0-9]*$/.test(coin.amount)) {
      throw new Error("AutoSign fee budgets must use positive base-unit coin amounts")
    }
    if (seenDenoms.has(coin.denom)) {
      throw new Error(`AutoSign fee budget contains duplicate denom: ${coin.denom}`)
    }
    seenDenoms.add(coin.denom)
  }

  if (feeBudget.spendLimit.length === 0) {
    throw new Error("AutoSign fee budget must contain at least one coin")
  }
}

export function buildAutoSignGrantMessages(
  params: BuildAutoSignGrantMessagesParams,
): AutoSignGrantMessage[] {
  const { granter, grantee, messageTypes, authorization, expiration, feeBudget } = params
  const uniqueMessageTypes = [...new Set(messageTypes)]
  assertAutoSignMessageTypesAllowed(uniqueMessageTypes)
  const feegrantMessage = buildAutoSignFeegrantMessage({ granter, grantee, expiration, feeBudget })

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
