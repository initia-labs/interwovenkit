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
  const params = {
    granter: "init1owner",
    grantee: "init1agent",
    messageTypes: ["/initia.move.v1.MsgExecute"],
  }

  it("encodes an optional cumulative fee budget in base units", () => {
    const messages = buildAutoSignGrantMessages({
      ...params,
      feeBudget: { spendLimit: [{ denom: "uinit", amount: "1250000" }] },
    })
    const feegrant = messages[0]!.value as MsgGrantAllowance
    const allowed = AllowedMsgAllowance.decode(feegrant.allowance!.value)
    const basic = BasicAllowance.decode(allowed.allowance!.value)

    expect(basic.spendLimit).toEqual([{ denom: "uinit", amount: "1250000" }])
  })

  it("keeps the allowance uncapped when no policy is configured", () => {
    const messages = buildAutoSignGrantMessages(params)
    const feegrant = messages[0]!.value as MsgGrantAllowance
    const allowed = AllowedMsgAllowance.decode(feegrant.allowance!.value)
    const basic = BasicAllowance.decode(allowed.allowance!.value)

    expect(basic.spendLimit).toEqual([])
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
