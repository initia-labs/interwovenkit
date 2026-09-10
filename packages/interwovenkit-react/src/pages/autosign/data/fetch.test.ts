import { afterEach, describe, expect, it, vi } from "vitest"
import type { FeegrantAllowance } from "./fetch"
import {
  fetchGrantsForParties,
  getAutoSignRestOptions,
  getFeegrantAllowedMessages,
  getFeegrantExpiration,
  getFeegrantSpendLimit,
  isFeegrantNotFoundResponse,
} from "./fetch"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("fetchGrantsForParties", () => {
  it("keeps both addresses on every paginated request", async () => {
    const requests: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : input.toString()
        requests.push(url)
        const isNextPage = new URL(url).searchParams.has("pagination.key")
        return new Response(
          JSON.stringify({
            grants: [
              {
                authorization: {
                  "@type": "/cosmos.authz.v1beta1.GenericAuthorization",
                  msg: isNextPage ? "/initia.move.v1.MsgExecute" : "/cosmos.bank.v1beta1.MsgSend",
                },
              },
            ],
            pagination: { next_key: isNextPage ? null : "next", total: "2" },
          }),
        )
      }),
    )

    const grants = await fetchGrantsForParties("https://rest.example", "init1owner", "init1signer")

    expect(grants).toEqual([
      expect.objectContaining({ granter: "init1owner", grantee: "init1signer" }),
      expect.objectContaining({ granter: "init1owner", grantee: "init1signer" }),
    ])
    expect(requests).toHaveLength(2)
    for (const request of requests) {
      const params = new URL(request).searchParams
      expect(params.get("granter")).toBe("init1owner")
      expect(params.get("grantee")).toBe("init1signer")
    }
    expect(new URL(requests[1]!).searchParams.get("pagination.key")).toBe("next")
  })
})

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
