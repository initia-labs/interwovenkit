import { describe, expect, it } from "vitest"
import type { FeegrantAllowance } from "./fetch"
import { getFeegrantAllowedMessages, getFeegrantExpiration } from "./fetch"

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
