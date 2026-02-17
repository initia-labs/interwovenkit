import { describe, expect, it } from "vitest"
import type { FeegrantAllowance, Grant } from "./fetch"
import { getFeegrantAllowedMessages, getFeegrantExpiration, normalizeAutoSignGrants } from "./fetch"

describe("feegrant helpers", () => {
  it("returns expiration from BasicAllowance", () => {
    const allowance: FeegrantAllowance["allowance"] = {
      "@type": "/cosmos.feegrant.v1beta1.BasicAllowance",
      expiration: "2099-12-31T23:59:59Z",
    }

    expect(getFeegrantExpiration(allowance)).toBe("2099-12-31T23:59:59Z")
    expect(getFeegrantAllowedMessages(allowance)).toBeUndefined()
  })

  it("returns nested expiration for AllowedMsgAllowance", () => {
    const allowance: FeegrantAllowance["allowance"] = {
      "@type": "/cosmos.feegrant.v1beta1.AllowedMsgAllowance",
      allowance: {
        "@type": "/cosmos.feegrant.v1beta1.BasicAllowance",
        expiration: "2099-12-31T23:59:59Z",
      },
      allowedMessages: ["/cosmos.authz.v1beta1.MsgExec"],
    }

    expect(getFeegrantExpiration(allowance)).toBe("2099-12-31T23:59:59Z")
    expect(getFeegrantAllowedMessages(allowance)).toEqual(["/cosmos.authz.v1beta1.MsgExec"])
  })

  it("supports snake_case allowed_messages from REST responses", () => {
    const allowance: FeegrantAllowance["allowance"] = {
      "@type": "/cosmos.feegrant.v1beta1.AllowedMsgAllowance",
      allowance: { "@type": "/cosmos.feegrant.v1beta1.BasicAllowance" },
      allowed_messages: ["/cosmos.authz.v1beta1.MsgExec"],
    }

    expect(getFeegrantAllowedMessages(allowance)).toEqual(["/cosmos.authz.v1beta1.MsgExec"])
  })
})

describe("normalizeAutoSignGrants", () => {
  it("keeps only GenericAuthorization grants with message types", () => {
    const grants: Grant[] = [
      {
        granter: "init1granter",
        grantee: "init1grantee",
        authorization: {
          "@type": "/cosmos.authz.v1beta1.GenericAuthorization",
          msg: "/initia.move.v1.MsgExecute",
        },
      },
      {
        granter: "init1granter",
        grantee: "init1grantee",
        authorization: {
          "@type": "/cosmos.authz.v1beta1.SendAuthorization",
          msg: "",
        },
      },
      {
        granter: "init1granter",
        grantee: "init1grantee",
        authorization: {
          "@type": "/cosmos.authz.v1beta1.GenericAuthorization",
          msg: "",
        },
      },
    ]

    expect(normalizeAutoSignGrants(grants)).toEqual([grants[0]])
  })
})
