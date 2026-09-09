import { describe, expect, it } from "vitest"
import type { FeegrantAllowance, Grant } from "./fetch"
import {
  getAutoSignRestOptions,
  getFeegrantAllowedMessages,
  getFeegrantExpiration,
  getFeegrantSpendLimit,
  isFeegrantNotFoundResponse,
  normalizeAutoSignGrants,
} from "./fetch"

describe("feegrant helpers", () => {
  it("bypasses stale browser caches for autosign REST reads", () => {
    expect(getAutoSignRestOptions("https://rest.example")).toEqual({
      prefixUrl: "https://rest.example",
      cache: "no-store",
    })
  })

  it("recognizes Initia's missing-feegrant gateway response without swallowing server failures", async () => {
    const response = (body: unknown, status = 500) => new Response(JSON.stringify(body), { status })
    expect(
      await isFeegrantNotFoundResponse(
        response({ code: 13, message: "fee-grant not found: not found", details: [] }),
      ),
    ).toBe(true)
    expect(await isFeegrantNotFoundResponse(response({}, 404))).toBe(true)
    expect(
      await isFeegrantNotFoundResponse(response({ code: 13, message: "database unavailable" })),
    ).toBe(false)
    expect(await isFeegrantNotFoundResponse(new Response("Bad Gateway", { status: 502 }))).toBe(
      false,
    )
  })

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
  it("retains unknown authorizations for explicit management", () => {
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

    expect(normalizeAutoSignGrants(grants)).toEqual(grants)
  })
})

describe("getFeegrantSpendLimit", () => {
  it("reads a cumulative cap from a nested BasicAllowance", () => {
    const allowance: FeegrantAllowance["allowance"] = {
      "@type": "/cosmos.feegrant.v1beta1.AllowedMsgAllowance",
      allowance: {
        "@type": "/cosmos.feegrant.v1beta1.BasicAllowance",
        spend_limit: [{ denom: "uinit", amount: "123" }],
      },
      allowedMessages: ["/cosmos.authz.v1beta1.MsgExec"],
    }

    expect(getFeegrantSpendLimit(allowance)).toEqual([{ denom: "uinit", amount: "123" }])
  })
})
