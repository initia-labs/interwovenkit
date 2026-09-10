import { describe, expect, it } from "vitest"
import { buildAutoSignGrantInventory } from "./inventory"

describe("buildAutoSignGrantInventory", () => {
  it("groups known and unknown authorizations without claiming unknown scopes are revocable", () => {
    const inventory = buildAutoSignGrantInventory({
      chainId: "initia-1",
      currentGrantee: "init1local",
      grants: [
        {
          granter: "init1owner",
          grantee: "init1local",
          authorization: {
            "@type": "/cosmos.authz.v1beta1.GenericAuthorization",
            msg: "/initia.move.v1.MsgExecute",
          },
        },
        {
          granter: "init1owner",
          grantee: "init1local",
          authorization: { "@type": "/example.unknown.v1.Authorization" },
        },
      ],
    })

    expect(inventory).toHaveLength(1)
    expect(inventory[0]).toMatchObject({
      attribution: "local-current",
      canRevoke: true,
      revocableMessageTypes: ["/initia.move.v1.MsgExecute"],
    })
    expect(inventory[0]!.authorizations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ known: true, revocable: true }),
        expect.objectContaining({ known: false, revocable: false }),
      ]),
    )
  })

  it("keeps fee-only allowances and reports unavailable allowance inventory as unknown", () => {
    const inventory = buildAutoSignGrantInventory({
      chainId: "initia-1",
      grants: [],
      feegrants: [
        {
          granter: "init1owner",
          grantee: "init1feeonly",
          allowance: { "@type": "/cosmos.feegrant.v1beta1.BasicAllowance" },
        },
      ],
    })
    expect(inventory).toMatchObject([
      { grantee: "init1feeonly", feeAllowance: { kind: "unlimited" }, canRevoke: true },
    ])

    const [authzOnly] = buildAutoSignGrantInventory({
      chainId: "initia-1",
      grants: [
        {
          granter: "init1owner",
          grantee: "init1authz",
          authorization: {
            "@type": "/cosmos.authz.v1beta1.GenericAuthorization",
            msg: "/initia.move.v1.MsgExecute",
          },
        },
      ],
      feegrantsAvailability: "unknown",
    })
    expect(authzOnly?.feeAllowance).toEqual({ kind: "unknown" })
  })

  it("marks unsupported fee codecs unknown and only presents BasicAllowance as unlimited", () => {
    const [unsupported, unrestricted] = buildAutoSignGrantInventory({
      chainId: "initia-1",
      grants: [],
      feegrants: [
        {
          granter: "init1owner",
          grantee: "init1unsupported",
          allowance: { "@type": "/cosmos.feegrant.v1beta1.PeriodicAllowance" },
        },
        {
          granter: "init1owner",
          grantee: "init1basic",
          allowance: { "@type": "/cosmos.feegrant.v1beta1.BasicAllowance" },
        },
      ],
    })

    expect(unsupported?.feeAllowance).toEqual({ kind: "unknown" })
    expect(unrestricted?.feeAllowance).toEqual({ kind: "unlimited", expiration: undefined })
  })

  it("retains a local expired identity for reconnection after REST has removed its grants", () => {
    const expiration = new Date("2026-09-09T12:00:54.211Z")
    const [expired] = buildAutoSignGrantInventory({
      chainId: "initiation-2",
      currentGrantee: "init1umkf0ag5zza7u97y2ny304xgdrshqmpamehss0",
      grants: [],
      expiredLocalIdentity: {
        grantee: "init1umkf0ag5zza7u97y2ny304xgdrshqmpamehss0",
        expiration,
      },
    })

    expect(expired).toMatchObject({
      grantee: "init1umkf0ag5zza7u97y2ny304xgdrshqmpamehss0",
      expiration,
      attribution: "local-current",
      authorizations: [],
      feeAllowance: { kind: "missing" },
      canRevoke: false,
      revokeReason: "This expired approval is no longer present on chain",
    })
  })

  it("waits for a complete feegrant inventory before claiming every approval is gone", () => {
    const inventory = buildAutoSignGrantInventory({
      chainId: "initiation-2",
      grants: [],
      feegrantsAvailability: "unknown",
      expiredLocalIdentity: {
        grantee: "init1umkf0ag5zza7u97y2ny304xgdrshqmpamehss0",
        expiration: new Date("2026-09-09T12:00:54.211Z"),
      },
    })

    expect(inventory).toEqual([])
  })
})
