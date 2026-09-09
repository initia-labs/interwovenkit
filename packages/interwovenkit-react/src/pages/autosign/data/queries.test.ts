import { describe, expect, it } from "vitest"
import {
  buildAutoSignGrantInventoryForChain,
  filterAutoSignGrantsByExpectedAddress,
} from "./queries"

const grants = [
  {
    granter: "init1granter",
    grantee: "init1granteeA",
    authorization: {
      "@type": "/cosmos.authz.v1beta1.GenericAuthorization",
      msg: "/initia.move.v1.MsgExecute",
    },
  },
  {
    granter: "init1granter",
    grantee: "init1granteeB",
    authorization: {
      "@type": "/cosmos.authz.v1beta1.GenericAuthorization",
      msg: "/initia.move.v1.MsgExecute",
    },
  },
]

describe("filterAutoSignGrantsByExpectedAddress", () => {
  it("returns all grants when expected address is undefined", () => {
    expect(filterAutoSignGrantsByExpectedAddress(grants, undefined)).toEqual(grants)
  })

  it("returns all grants when expected address key is missing", () => {
    expect(filterAutoSignGrantsByExpectedAddress(grants, null)).toEqual(grants)
  })

  it("filters grants when expected address exists", () => {
    expect(filterAutoSignGrantsByExpectedAddress(grants, "init1granteeB")).toEqual([grants[1]])
  })
})

describe("buildAutoSignGrantInventoryForChain", () => {
  it("attributes a durable random status identity as current before the legacy mirror", () => {
    const inventory = buildAutoSignGrantInventoryForChain({
      chainId: "initia-1",
      grants,
      initiaAddress: "init1granter",
      currentGrantee: "init1granteeB",
      knownGrantees: ["init1granteeA"],
    })

    expect(inventory.map((item) => [item.grantee, item.attribution])).toEqual([
      ["init1granteeA", "locally-known"],
      ["init1granteeB", "local-current"],
    ])
  })

  it("keeps a recorded expired local identity when the chain has removed every grant", () => {
    const expiration = new Date("2026-09-09T12:00:54.211Z")
    const inventory = buildAutoSignGrantInventoryForChain({
      chainId: "initiation-2",
      grants: [],
      initiaAddress: "init1granter",
      currentGrantee: "init1umkf0ag5zza7u97y2ny304xgdrshqmpamehss0",
      expiredLocalIdentity: {
        grantee: "init1umkf0ag5zza7u97y2ny304xgdrshqmpamehss0",
        expiration,
      },
    })

    expect(inventory).toMatchObject([
      {
        grantee: "init1umkf0ag5zza7u97y2ny304xgdrshqmpamehss0",
        expiration,
        attribution: "local-current",
        canRevoke: false,
      },
    ])
  })
})
