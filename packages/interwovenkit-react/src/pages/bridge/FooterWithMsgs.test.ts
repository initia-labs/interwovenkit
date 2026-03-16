import { getBridgeMsgsRequestKey } from "./data/messageRequestKey"

describe("getBridgeMsgsRequestKey", () => {
  it("changes when quoteVerifiedAt changes even if route inputs stay the same", () => {
    const base = {
      addressList: ["init1test"],
      operations: [{ transfer: "same-route" }],
      signedOpHook: { signer: "init1test", hook: "hook" },
    }

    expect(
      getBridgeMsgsRequestKey({
        ...base,
        quoteVerifiedAt: 10,
      }),
    ).not.toBe(
      getBridgeMsgsRequestKey({
        ...base,
        quoteVerifiedAt: 20,
      }),
    )
  })
})
