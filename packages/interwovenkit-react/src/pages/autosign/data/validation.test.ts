import { describe, expect, it, vi } from "vitest"
import type { FeegrantAllowance } from "./fetch"
import { validateAutoSignMessages } from "./policy"
import {
  canActivatePendingAutoSignIdentity,
  createAutoSignMessageTypesKey,
  createAutoSignNetworkKey,
  fetchAutoSignStatus,
  findEarliestDate,
  findValidGranteeCandidates,
  findValidGranteeWithFeegrant,
  isAutoSignStatusEnabledAndFresh,
  isFeegrantEligibleForAutoSign,
  resolveAutoSignEnabledForChain,
  resolveAutoSignMessageTypes,
  resolveAutoSignValidationAuthorization,
} from "./validation"

const findFirstValidGrantee = (
  grants: Parameters<typeof findValidGranteeCandidates>[0],
  requiredMsgTypes: Parameters<typeof findValidGranteeCandidates>[1],
) => {
  return findValidGranteeCandidates(grants, requiredMsgTypes)[0] ?? null
}

describe("fetchAutoSignStatus", () => {
  it("short-circuits when all configured message type arrays are empty", async () => {
    const fetchAllGrants = vi.fn().mockResolvedValue([])
    const fetchFeegrant = vi.fn().mockResolvedValue(null)

    const result = await fetchAutoSignStatus({
      initiaAddress: "init1granter",
      messageTypes: {
        "initia-1": [],
        "initia-2": [],
      },
      fetchAllGrants,
      fetchFeegrant,
    })

    expect(fetchAllGrants).not.toHaveBeenCalled()
    expect(fetchFeegrant).not.toHaveBeenCalled()
    expect(result).toEqual({
      expiredAtByChain: {
        "initia-1": null,
        "initia-2": null,
      },
      feegrantByChain: {
        "initia-1": undefined,
        "initia-2": undefined,
      },
      isEnabledByChain: {
        "initia-1": false,
        "initia-2": false,
      },
      granteeByChain: {
        "initia-1": undefined,
        "initia-2": undefined,
      },
      requestedDurationInMsByChain: {
        "initia-1": undefined,
        "initia-2": undefined,
      },
      observedAuthorizationByChain: {
        "initia-1": undefined,
        "initia-2": undefined,
      },
      statusByChain: {
        "initia-1": "disabled",
        "initia-2": "disabled",
      },
    })
  })

  it("degrades an unavailable identity store to an unknown chain status", async () => {
    const fetchAllGrants = vi.fn()
    const result = await fetchAutoSignStatus({
      initiaAddress: "init1granter",
      messageTypes: { "initia-1": ["/initia.move.v1.MsgExecute"] },
      fetchActiveIdentity: vi.fn().mockRejectedValue(new Error("IndexedDB blocked")),
      fetchAllGrants,
      fetchFeegrant: vi.fn(),
    })

    expect(result.statusByChain["initia-1"]).toBe("unknown")
    expect(result.isEnabledByChain["initia-1"]).toBe(false)
    expect(fetchAllGrants).not.toHaveBeenCalled()
  })

  it("reports an RPC failure as unknown rather than a revoked grant", async () => {
    const result = await fetchAutoSignStatus({
      initiaAddress: "init1granter",
      messageTypes: { "initia-1": ["/initia.move.v1.MsgExecute"] },
      fetchAllGrants: vi.fn().mockRejectedValue(new Error("RPC unavailable")),
      fetchFeegrant: vi.fn(),
    })

    expect(result.statusByChain["initia-1"]).toBe("unknown")
    expect(result.expiredAtByChain["initia-1"]).toBeUndefined()
    expect(result.isEnabledByChain["initia-1"]).toBe(false)
  })

  it("does not surface a paused identity as expired while its revoke outcome is unresolved", async () => {
    const result = await fetchAutoSignStatus({
      initiaAddress: "init1granter",
      messageTypes: { "initia-1": ["/initia.move.v1.MsgExecute"] },
      fetchActiveIdentity: vi.fn().mockResolvedValue(undefined),
      fetchKnownIdentity: vi.fn().mockResolvedValue({
        address: "init1paused",
        observedExpiration: "2020-01-01T00:00:00Z",
        requestedDurationMs: 86_400_000,
      }),
      fetchAllGrants: vi.fn().mockResolvedValue([]),
      fetchFeegrant: vi.fn(),
    })

    expect(result.statusByChain["initia-1"]).toBe("disabled")
    expect(result.granteeByChain["initia-1"]).toBeUndefined()
    expect(result.expiredAtByChain["initia-1"]).toBeNull()
  })

  it("includes a finite typed authorization expiry in chain status", async () => {
    const result = await fetchAutoSignStatus({
      initiaAddress: "init1granter",
      messageTypes: { "initia-1": ["/minievm.evm.v1.MsgCall"] },
      authorizationPolicies: {
        "initia-1": {
          kind: "evm",
          contracts: ["0xabc0000000000000000000000000000000000000"],
        },
      },
      fetchActiveIdentity: vi.fn().mockResolvedValue({ address: "init1agent" }),
      fetchAllGrants: vi.fn().mockResolvedValue([
        {
          grantee: "init1agent",
          authorization: {
            "@type": "/minievm.evm.v1.CallAuthorization",
            contracts: ["0xabc0000000000000000000000000000000000000"],
          },
          expiration: "2099-12-31T23:59:59Z",
        },
      ]),
      fetchFeegrant: vi.fn().mockResolvedValue({
        grantee: "init1agent",
        allowance: {
          "@type": "/cosmos.feegrant.v1beta1.AllowedMsgAllowance",
          allowance: { "@type": "/cosmos.feegrant.v1beta1.BasicAllowance" },
          allowedMessages: ["/cosmos.authz.v1beta1.MsgExec"],
        },
      }),
    })

    expect(result.statusByChain["initia-1"]).toBe("enabled")
    expect(result.expiredAtByChain["initia-1"]?.toISOString()).toBe("2099-12-31T23:59:59.000Z")
  })

  it("only fetches grants for chains with configured message types", async () => {
    const fetchAllGrants = vi.fn().mockResolvedValue([])
    const fetchFeegrant = vi.fn().mockResolvedValue(null)

    const result = await fetchAutoSignStatus({
      initiaAddress: "init1granter",
      messageTypes: {
        "initia-empty": [],
        "initia-active": ["/initia.move.v1.MsgExecute"],
      },
      fetchAllGrants,
      fetchFeegrant,
    })

    expect(fetchAllGrants).toHaveBeenCalledTimes(1)
    expect(fetchAllGrants).toHaveBeenCalledWith("initia-active")
    expect(fetchFeegrant).not.toHaveBeenCalled()
    expect(result.expiredAtByChain["initia-empty"]).toBeNull()
    expect(result.isEnabledByChain["initia-empty"]).toBe(false)
  })
})

describe("resolveAutoSignValidationAuthorization", () => {
  it("enforces the lower observed Wasm call limit", () => {
    const configured = {
      kind: "wasm" as const,
      grants: [
        {
          contract: "init1contract",
          filter: { kind: "allow-all" as const },
          limit: { kind: "max-calls" as const, remaining: 2n },
        },
      ],
    }
    const observed = {
      ...configured,
      grants: [{ ...configured.grants[0]!, limit: { kind: "max-calls" as const, remaining: 1n } }],
    }
    const policy = resolveAutoSignValidationAuthorization({ configured, observed })
    expect(policy).toEqual(observed)
    expect(
      validateAutoSignMessages(policy!, [
        {
          typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
          value: { contract: "init1contract", msg: new TextEncoder().encode('{"swap":{}}') },
        },
        {
          typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
          value: { contract: "init1contract", msg: new TextEncoder().encode('{"swap":{}}') },
        },
      ]).valid,
    ).toBe(false)
  })
})

describe("current autosign status", () => {
  it("requires a recent status result and an unexpired current permission", () => {
    const status = {
      expiredAtByChain: { "initia-1": new Date(20_000) },
      feegrantByChain: {},
      isEnabledByChain: { "initia-1": true },
      granteeByChain: { "initia-1": "init1agent" },
      requestedDurationInMsByChain: {},
      observedAuthorizationByChain: {},
      statusByChain: { "initia-1": "enabled" as const },
    }

    expect(
      isAutoSignStatusEnabledAndFresh({
        status,
        dataUpdatedAt: 9_000,
        chainId: "initia-1",
        now: 10_000,
      }),
    ).toBe(true)
    expect(
      isAutoSignStatusEnabledAndFresh({
        status,
        dataUpdatedAt: 1,
        chainId: "initia-1",
        now: 61_002,
      }),
    ).toBe(false)
    expect(
      isAutoSignStatusEnabledAndFresh({
        status: { ...status, expiredAtByChain: { "initia-1": new Date(9_999) } },
        dataUpdatedAt: 9_000,
        chainId: "initia-1",
        now: 10_000,
      }),
    ).toBe(false)
  })

  it("separates status cache entries by registry endpoint and chain RPC endpoints", () => {
    const configuredChainIds = ["initia-1"]
    expect(
      createAutoSignNetworkKey(
        "https://registry.example",
        [{ chainId: "initia-1", restUrl: "https://rest.one", rpcUrl: "https://rpc.one" }],
        configuredChainIds,
      ),
    ).not.toBe(
      createAutoSignNetworkKey(
        "https://registry.example",
        [{ chainId: "initia-1", restUrl: "https://rest.two", rpcUrl: "https://rpc.one" }],
        configuredChainIds,
      ),
    )
  })
})

describe("findFirstValidGrantee", () => {
  const msgType1 = "/initia.move.v1.MsgExecute"
  const msgType2 = "/cosmos.bank.v1beta1.MsgSend"

  describe("no matching grantee", () => {
    it("returns null for empty grants array", () => {
      const result = findFirstValidGrantee([], [msgType1])

      expect(result).toBeNull()
    })

    it("returns null when no grantee has required message type", () => {
      const grants = [
        { grantee: "init1abc", authorization: { msg: "/some.other.MsgType" } },
        { grantee: "init1def", authorization: { msg: "/another.MsgType" } },
      ]

      const result = findFirstValidGrantee(grants, [msgType1])

      expect(result).toBeNull()
    })

    it("returns null when grantee has partial match", () => {
      const grants = [{ grantee: "init1abc", authorization: { msg: msgType1 } }]

      const result = findFirstValidGrantee(grants, [msgType1, msgType2])

      expect(result).toBeNull()
    })

    it("returns null when required types are split across grantees", () => {
      const grants = [
        { grantee: "init1abc", authorization: { msg: msgType1 } },
        { grantee: "init1def", authorization: { msg: msgType2 } },
      ]

      const result = findFirstValidGrantee(grants, [msgType1, msgType2])

      expect(result).toBeNull()
    })
  })

  describe("single required message type", () => {
    it("finds grantee with matching message type", () => {
      const grants = [{ grantee: "init1abc", authorization: { msg: msgType1 } }]

      const result = findFirstValidGrantee(grants, [msgType1])

      expect(result).not.toBeNull()
      expect(result?.grantee).toBe("init1abc")
    })

    it("returns first matching grantee when multiple match", () => {
      const grants = [
        { grantee: "init1first", authorization: { msg: msgType1 } },
        { grantee: "init1second", authorization: { msg: msgType1 } },
      ]

      const result = findFirstValidGrantee(grants, [msgType1])

      expect(result?.grantee).toBe("init1first")
    })
  })

  describe("multiple required message types", () => {
    it("finds grantee with all required message types", () => {
      const grants = [
        { grantee: "init1abc", authorization: { msg: msgType1 } },
        { grantee: "init1abc", authorization: { msg: msgType2 } },
      ]

      const result = findFirstValidGrantee(grants, [msgType1, msgType2])

      expect(result).not.toBeNull()
      expect(result?.grantee).toBe("init1abc")
      expect(result?.grants).toHaveLength(2)
    })

    it("skips grantee with partial match, finds complete match", () => {
      const grants = [
        { grantee: "init1partial", authorization: { msg: msgType1 } },
        { grantee: "init1complete", authorization: { msg: msgType1 } },
        { grantee: "init1complete", authorization: { msg: msgType2 } },
      ]

      const result = findFirstValidGrantee(grants, [msgType1, msgType2])

      expect(result?.grantee).toBe("init1complete")
    })

    it("handles duplicate grants for same message type", () => {
      const grants = [
        { grantee: "init1abc", authorization: { msg: msgType1 } },
        { grantee: "init1abc", authorization: { msg: msgType1 } },
        { grantee: "init1abc", authorization: { msg: msgType2 } },
      ]

      const result = findFirstValidGrantee(grants, [msgType1, msgType2])

      expect(result).not.toBeNull()
      expect(result?.grantee).toBe("init1abc")
    })
  })

  describe("expiration handling", () => {
    it("includes expiration in returned grants", () => {
      const expiration = "2099-12-31T23:59:59Z"
      const grants = [{ grantee: "init1abc", authorization: { msg: msgType1 }, expiration }]

      const result = findFirstValidGrantee(grants, [msgType1])

      expect(result?.grants[0].expiration).toBe(expiration)
    })

    it("handles grants without expiration", () => {
      const grants = [{ grantee: "init1abc", authorization: { msg: msgType1 } }]

      const result = findFirstValidGrantee(grants, [msgType1])

      expect(result?.grants[0].expiration).toBeUndefined()
    })

    it("handles mixed expiration states", () => {
      const grants = [
        {
          grantee: "init1abc",
          authorization: { msg: msgType1 },
          expiration: "2099-12-31T23:59:59Z",
        },
        { grantee: "init1abc", authorization: { msg: msgType2 } },
      ]

      const result = findFirstValidGrantee(grants, [msgType1, msgType2])

      expect(result?.grants).toHaveLength(2)
      expect(result?.grants.find((g) => g.authorization.msg === msgType1)?.expiration).toBeDefined()
      expect(
        result?.grants.find((g) => g.authorization.msg === msgType2)?.expiration,
      ).toBeUndefined()
    })

    it("filters out expired grants", () => {
      const grants = [
        {
          grantee: "init1abc",
          authorization: { msg: msgType1 },
          expiration: "2020-01-01T00:00:00Z",
        },
      ]

      const result = findFirstValidGrantee(grants, [msgType1])

      expect(result).toBeNull()
    })

    it("returns null when all matching grants are expired", () => {
      const grants = [
        {
          grantee: "init1abc",
          authorization: { msg: msgType1 },
          expiration: "2020-01-01T00:00:00Z",
        },
        {
          grantee: "init1abc",
          authorization: { msg: msgType2 },
          expiration: "2099-12-31T23:59:59Z",
        },
      ]

      const result = findFirstValidGrantee(grants, [msgType1, msgType2])

      expect(result).toBeNull()
    })

    it("finds grantee with valid grants when another has expired grants", () => {
      const grants = [
        {
          grantee: "init1expired",
          authorization: { msg: msgType1 },
          expiration: "2020-01-01T00:00:00Z",
        },
        {
          grantee: "init1valid",
          authorization: { msg: msgType1 },
          expiration: "2099-12-31T23:59:59Z",
        },
      ]

      const result = findFirstValidGrantee(grants, [msgType1])

      expect(result?.grantee).toBe("init1valid")
    })
  })

  describe("empty required types", () => {
    it("returns null when no message types are required", () => {
      const grants = [{ grantee: "init1abc", authorization: { msg: msgType1 } }]

      const result = findFirstValidGrantee(grants, [])

      expect(result).toBeNull()
    })

    it("returns null for empty grants with empty required types", () => {
      const result = findFirstValidGrantee([], [])

      expect(result).toBeNull()
    })
  })
})

describe("findValidGranteeCandidates", () => {
  it("returns all authz-valid grantees in encounter order", () => {
    const msgType = "/initia.move.v1.MsgExecute"
    const grants = [
      { grantee: "init1first", authorization: { msg: msgType } },
      { grantee: "init1second", authorization: { msg: msgType } },
    ]

    const result = findValidGranteeCandidates(grants, [msgType])

    expect(result.map((candidate) => candidate.grantee)).toEqual(["init1first", "init1second"])
  })
})

describe("canActivatePendingAutoSignIdentity", () => {
  it("promotes only the exact pending grantee after full verification", () => {
    expect(
      canActivatePendingAutoSignIdentity({
        status: "enabled",
        matchedGrantee: "init1pending",
        pendingAddress: "init1pending",
      }),
    ).toBe(true)
    expect(
      canActivatePendingAutoSignIdentity({
        status: "needs-permission-update",
        matchedGrantee: "init1pending",
        pendingAddress: "init1pending",
      }),
    ).toBe(false)
    expect(
      canActivatePendingAutoSignIdentity({
        status: "enabled",
        matchedGrantee: "init1other",
        pendingAddress: "init1pending",
      }),
    ).toBe(false)
  })
})

describe("findValidGranteeWithFeegrant", () => {
  const allowExecFeegrant: FeegrantAllowance = {
    granter: "init1granter",
    grantee: "init1candidate",
    allowance: {
      "@type": "/cosmos.feegrant.v1beta1.AllowedMsgAllowance",
      allowance: {
        "@type": "/cosmos.feegrant.v1beta1.BasicAllowance",
      },
      allowedMessages: ["/cosmos.authz.v1beta1.MsgExec"],
    },
  }

  it("rejects unsupported and depleted fee allowance codecs", () => {
    expect(
      isFeegrantEligibleForAutoSign({
        granter: "init1granter",
        grantee: "init1candidate",
        allowance: { "@type": "/cosmos.feegrant.v1beta1.PeriodicAllowance" },
      }),
    ).toBe(false)
    expect(
      isFeegrantEligibleForAutoSign({
        granter: "init1granter",
        grantee: "init1candidate",
        allowance: {
          "@type": "/cosmos.feegrant.v1beta1.AllowedMsgAllowance",
          allowance: {
            "@type": "/cosmos.feegrant.v1beta1.BasicAllowance",
            spendLimit: [{ denom: "uinit", amount: "0" }],
          },
          allowedMessages: ["/cosmos.authz.v1beta1.MsgExec"],
        },
      }),
    ).toBe(false)
  })

  it("skips candidate without feegrant and selects next eligible candidate", async () => {
    const candidates = [
      {
        grantee: "init1candidateA",
        grants: [{ authorization: { msg: "/initia.move.v1.MsgExecute" } }],
      },
      {
        grantee: "init1candidateB",
        grants: [{ authorization: { msg: "/initia.move.v1.MsgExecute" } }],
      },
    ]

    const result = await findValidGranteeWithFeegrant({
      chainId: "initia-1",
      candidates,
      fetchFeegrant: async (_chainId, grantee) =>
        grantee === "init1candidateB" ? allowExecFeegrant : null,
    })

    expect(result?.grantee.grantee).toBe("init1candidateB")
  })

  it("skips feegrant that does not allow MsgExec", async () => {
    const candidates = [
      {
        grantee: "init1candidateA",
        grants: [{ authorization: { msg: "/initia.move.v1.MsgExecute" } }],
      },
      {
        grantee: "init1candidateB",
        grants: [{ authorization: { msg: "/initia.move.v1.MsgExecute" } }],
      },
    ]

    const disallowExecFeegrant: FeegrantAllowance = {
      granter: "init1granter",
      grantee: "init1candidateA",
      allowance: {
        "@type": "/cosmos.feegrant.v1beta1.AllowedMsgAllowance",
        allowance: {
          "@type": "/cosmos.feegrant.v1beta1.BasicAllowance",
        },
        allowedMessages: ["/cosmos.bank.v1beta1.MsgSend"],
      },
    }

    const result = await findValidGranteeWithFeegrant({
      chainId: "initia-1",
      candidates,
      fetchFeegrant: async (_chainId, grantee) =>
        grantee === "init1candidateA" ? disallowExecFeegrant : allowExecFeegrant,
    })

    expect(result?.grantee.grantee).toBe("init1candidateB")
  })

  it("keeps candidate priority even when later candidates resolve faster", async () => {
    const candidates = [
      {
        grantee: "init1candidateA",
        grants: [{ authorization: { msg: "/initia.move.v1.MsgExecute" } }],
      },
      {
        grantee: "init1candidateB",
        grants: [{ authorization: { msg: "/initia.move.v1.MsgExecute" } }],
      },
    ]

    const result = await findValidGranteeWithFeegrant({
      chainId: "initia-1",
      candidates,
      fetchFeegrant: async (_chainId, grantee) => {
        if (grantee === "init1candidateA") {
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        return allowExecFeegrant
      },
      concurrency: 2,
    })

    expect(result?.grantee.grantee).toBe("init1candidateA")
  })

  it("skips expired feegrant and selects candidate with active feegrant", async () => {
    const candidates = [
      {
        grantee: "init1candidateA",
        grants: [{ authorization: { msg: "/initia.move.v1.MsgExecute" } }],
      },
      {
        grantee: "init1candidateB",
        grants: [{ authorization: { msg: "/initia.move.v1.MsgExecute" } }],
      },
    ]

    const expiredFeegrant: FeegrantAllowance = {
      granter: "init1granter",
      grantee: "init1candidateA",
      allowance: {
        "@type": "/cosmos.feegrant.v1beta1.BasicAllowance",
        expiration: "2020-01-01T00:00:00Z",
      },
    }

    const activeFeegrant: FeegrantAllowance = {
      granter: "init1granter",
      grantee: "init1candidateB",
      allowance: {
        "@type": "/cosmos.feegrant.v1beta1.BasicAllowance",
        expiration: "2099-01-01T00:00:00Z",
      },
    }

    const result = await findValidGranteeWithFeegrant({
      chainId: "initia-1",
      candidates,
      fetchFeegrant: async (_chainId, grantee) =>
        grantee === "init1candidateA" ? expiredFeegrant : activeFeegrant,
    })

    expect(result?.grantee.grantee).toBe("init1candidateB")
  })
})

describe("resolveAutoSignEnabledForChain", () => {
  it("returns false when expiration is null", () => {
    const result = resolveAutoSignEnabledForChain({
      expiration: null,
      grantee: "init1grantee",
      expectedAddress: "init1grantee",
    })

    expect(result).toBe(false)
  })

  it("returns true for permanent grant when addresses match", () => {
    const result = resolveAutoSignEnabledForChain({
      expiration: undefined,
      grantee: "init1grantee",
      expectedAddress: "init1grantee",
    })

    expect(result).toBe(true)
  })

  it("returns true for permanent grant when expected address is unavailable", () => {
    const result = resolveAutoSignEnabledForChain({
      expiration: undefined,
      grantee: "init1grantee",
      expectedAddress: undefined,
    })

    expect(result).toBe(true)
  })

  it("returns false for permanent grant when expected address key is missing", () => {
    const result = resolveAutoSignEnabledForChain({
      expiration: undefined,
      grantee: "init1grantee",
      expectedAddress: null,
    })

    expect(result).toBe(false)
  })

  it("returns false for permanent grant when addresses do not match", () => {
    const result = resolveAutoSignEnabledForChain({
      expiration: undefined,
      grantee: "init1grantee",
      expectedAddress: "init1other",
    })

    expect(result).toBe(false)
  })

  it("returns true for future expiration when addresses match", () => {
    const result = resolveAutoSignEnabledForChain({
      expiration: new Date("2099-01-01T00:00:00Z"),
      grantee: "init1grantee",
      expectedAddress: "init1grantee",
    })

    expect(result).toBe(true)
  })

  it("returns false for future expiration when addresses do not match", () => {
    const result = resolveAutoSignEnabledForChain({
      expiration: new Date("2099-01-01T00:00:00Z"),
      grantee: "init1grantee",
      expectedAddress: "init1other",
    })

    expect(result).toBe(false)
  })

  it("returns false for expired grants", () => {
    const result = resolveAutoSignEnabledForChain({
      expiration: new Date("2020-01-01T00:00:00Z"),
      grantee: "init1grantee",
      expectedAddress: "init1grantee",
    })

    expect(result).toBe(false)
  })
})

describe("createAutoSignMessageTypesKey", () => {
  it("creates a stable key regardless of chain order", () => {
    const first = createAutoSignMessageTypesKey({
      "initia-2": ["/initia.move.v1.MsgExecute"],
      "initia-1": ["/cosmwasm.wasm.v1.MsgExecuteContract"],
    })

    const second = createAutoSignMessageTypesKey({
      "initia-1": ["/cosmwasm.wasm.v1.MsgExecuteContract"],
      "initia-2": ["/initia.move.v1.MsgExecute"],
    })

    expect(first).toBe(second)
  })

  it("creates a stable key regardless of message type order", () => {
    const first = createAutoSignMessageTypesKey({
      "initia-1": ["/b.Msg", "/a.Msg"],
    })

    const second = createAutoSignMessageTypesKey({
      "initia-1": ["/a.Msg", "/b.Msg"],
    })

    expect(first).toBe(second)
  })

  it("changes key when message type configuration changes", () => {
    const current = createAutoSignMessageTypesKey({
      "initia-1": ["/initia.move.v1.MsgExecute"],
    })

    const next = createAutoSignMessageTypesKey({
      "initia-1": ["/initia.move.v1.MsgExecute", "/cosmos.bank.v1beta1.MsgSend"],
    })

    expect(current).not.toBe(next)
  })
})

describe("findEarliestDate", () => {
  it("returns undefined for empty array", () => {
    expect(findEarliestDate([])).toBeUndefined()
  })

  it("returns undefined when all elements are undefined", () => {
    expect(findEarliestDate([undefined, undefined])).toBeUndefined()
  })

  it("returns the earliest Date from Date array", () => {
    const earliest = new Date("2024-01-01T00:00:00Z")
    const later = new Date("2025-06-15T00:00:00Z")
    const latest = new Date("2026-12-31T00:00:00Z")

    expect(findEarliestDate([later, latest, earliest])).toBe(earliest)
  })

  it("returns the earliest string from string array", () => {
    const earliest = "2024-01-01T00:00:00Z"
    const later = "2025-06-15T00:00:00Z"
    const latest = "2026-12-31T00:00:00Z"

    expect(findEarliestDate([later, latest, earliest])).toBe(earliest)
  })

  it("filters out undefined values and returns the earliest", () => {
    const earliest = new Date("2024-01-01T00:00:00Z")
    const later = new Date("2025-06-15T00:00:00Z")

    expect(findEarliestDate([undefined, later, undefined, earliest])).toBe(earliest)
  })
})

describe("resolveAutoSignMessageTypes", () => {
  const moveType = "/initia.move.v1.MsgExecute"
  const evmType = "/minievm.evm.v1.MsgCall"
  const bankType = "/cosmos.bank.v1beta1.MsgSend"
  const scoped = {
    move: {
      authorization: {
        kind: "move" as const,
        items: [{ moduleAddress: "0x1", moduleName: "counter", functionNames: ["increment"] }],
      },
    },
    evm: {
      authorization: {
        kind: "evm" as const,
        contracts: ["0x0000000000000000000000000000000000000001"],
      },
    },
  }

  it("infers typed message types and enables scoped chains without the legacy prop", () => {
    expect(
      resolveAutoSignMessageTypes({ defaultChainId: "other", autoSignGrantPolicy: scoped }),
    ).toEqual({ move: [moveType], evm: [evmType] })
  })

  it("lets explicit false disable all scoped and default chains", async () => {
    const messageTypes = resolveAutoSignMessageTypes({
      defaultChainId: "move",
      enableAutoSign: false,
      autoSignGrantPolicy: scoped,
    })
    expect(messageTypes).toEqual({ move: [] })
    const fetchAllGrants = vi.fn()
    const fetchFeegrant = vi.fn()
    const status = await fetchAutoSignStatus({
      initiaAddress: "init1owner",
      messageTypes,
      fetchAllGrants,
      fetchFeegrant,
    })
    expect(Object.values(status.isEnabledByChain).some(Boolean)).toBe(false)
    expect(fetchAllGrants).not.toHaveBeenCalled()
  })

  it.each([
    [undefined, moveType],
    ["minievm", evmType],
    ["miniwasm", "/cosmwasm.wasm.v1.MsgExecuteContract"],
  ])("preserves legacy true default selection for %s", (chainType, messageType) => {
    expect(
      resolveAutoSignMessageTypes({ defaultChainId: "default", enableAutoSign: true }, chainType),
    ).toEqual({ default: [messageType] })
  })

  it("keeps fee budgets optional and never treats a budget alone as opt-in", () => {
    const config = {
      defaultChainId: "move",
      autoSignGrantPolicy: { move: { feeBudget: [{ denom: "uinit", amount: "100" }] } },
    }
    expect(resolveAutoSignMessageTypes(config)).toEqual({ move: [] })
    expect(
      resolveAutoSignMessageTypes({ ...config, enableAutoSign: { move: [bankType] } }),
    ).toEqual({ move: [bankType] })
  })

  it("lets explicit scopes replace overlapping legacy types while retaining other chains", () => {
    const legacy = { move: [bankType], another: [bankType] }
    expect(
      resolveAutoSignMessageTypes({
        defaultChainId: "move",
        enableAutoSign: legacy,
        autoSignGrantPolicy: scoped,
      }),
    ).toEqual({ move: [moveType], evm: [evmType], another: [bankType] })
    expect(legacy.move).toEqual([bankType])
  })

  it("takes explicit generic message types from the policy without enabling an empty policy", () => {
    expect(
      resolveAutoSignMessageTypes({
        defaultChainId: "default",
        autoSignGrantPolicy: {
          bank: { authorization: { kind: "generic", messageTypes: [bankType] } },
          empty: { authorization: { kind: "generic", messageTypes: [] } },
        },
      }),
    ).toEqual({ bank: [bankType], empty: [] })
  })
})
