import { describe, expect, it } from "vitest"
import { filterAutoSignGrantsByExpectedAddress } from "./queries"

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
