import { describe, expect, it } from "vitest"
import { buildAutoSignGrantInventoryForChain } from "./queries"

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
})
