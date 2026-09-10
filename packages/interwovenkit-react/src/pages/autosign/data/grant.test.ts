import { describe, expect, it } from "vitest"
import { GenericAuthorization } from "@initia/initia.proto/cosmos/authz/v1beta1/authz"
import type { MsgGrant } from "@initia/initia.proto/cosmos/authz/v1beta1/tx"
import {
  AllowedMsgAllowance,
  BasicAllowance,
} from "@initia/initia.proto/cosmos/feegrant/v1beta1/feegrant"
import type { MsgGrantAllowance } from "@initia/initia.proto/cosmos/feegrant/v1beta1/tx"
import { buildAutoSignGrantMessages } from "./grant"

describe("buildAutoSignGrantMessages", () => {
  const expiration = new Date("2030-01-02T03:04:05.000Z")
  const params = {
    granter: "init1owner",
    grantee: "init1agent",
    messageTypes: ["/initia.move.v1.MsgExecute"],
    expiration,
  }

  it("creates an uncapped allowance for delegated transaction fees", () => {
    const messages = buildAutoSignGrantMessages(params)
    const feegrant = messages[0]!.value as MsgGrantAllowance
    const allowed = AllowedMsgAllowance.decode(feegrant.allowance!.value)
    const basic = BasicAllowance.decode(allowed.allowance!.value)

    expect(feegrant.allowance?.typeUrl).toBe("/cosmos.feegrant.v1beta1.AllowedMsgAllowance")
    expect(allowed.allowedMessages).toEqual(["/cosmos.authz.v1beta1.MsgExec"])
    expect(allowed.allowance?.typeUrl).toBe("/cosmos.feegrant.v1beta1.BasicAllowance")
    expect(basic.spendLimit).toEqual([])
    expect(basic.expiration).toEqual(expiration)
  })

  it("rejects permission-management messages before constructing a grant", () => {
    expect(() =>
      buildAutoSignGrantMessages({ ...params, messageTypes: ["/cosmos.authz.v1beta1.MsgExec"] }),
    ).toThrow("cannot delegate permission-management")
  })

  it("constructs a GenericAuthorization for every requested message", () => {
    const messages = buildAutoSignGrantMessages(params)
    const authz = messages[1]!.value as MsgGrant
    const authorization = GenericAuthorization.decode(authz.grant!.authorization!.value)

    expect(authorization.msg).toBe("/initia.move.v1.MsgExecute")
  })
})
