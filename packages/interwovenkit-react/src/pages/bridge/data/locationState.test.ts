import type { FormValues } from "./form"
import { buildReconfirmLocationState, buildRouteRefreshLocationState } from "./locationState"
import type { RouterRouteResponseJson } from "./simulate"

describe("bridge preview location state builders", () => {
  const route = { amount_in: "10" } as unknown as RouterRouteResponseJson
  const values = { srcChainId: "interwoven-1" } as unknown as FormValues

  it("preserves existing state when route refresh marks reconfirm required", () => {
    const currentState = {
      recipientAddress: "init1wlvk4e083pd3nddlfe5quy56e68atra3gu9xfs",
      localOptions: [{ chainId: "interwoven-1", denom: "uinit" }],
      quoteVerifiedAt: 1,
    }

    const nextState = buildRouteRefreshLocationState({
      currentState,
      route,
      values,
      quoteVerifiedAt: 12345,
    })

    expect(nextState.recipientAddress).toBe(currentState.recipientAddress)
    expect(nextState.localOptions).toEqual(currentState.localOptions)
    expect(nextState.quoteVerifiedAt).toBe(12345)
    expect(nextState.requiresReconfirm).toBe(true)
  })

  it("preserves existing state when reconfirm flag is cleared", () => {
    const currentState = {
      recipientAddress: "init1prdwrp2kwss8lg854u08vya6uw8t9mldsqchdv",
      remoteOptions: [{ chainId: "ethereum-1", denom: "0x1234" }],
      requiresReconfirm: true,
    }

    const nextState = buildReconfirmLocationState({
      currentState,
      route,
      values,
      quoteVerifiedAt: 999,
    })

    expect(nextState.recipientAddress).toBe(currentState.recipientAddress)
    expect(nextState.remoteOptions).toEqual(currentState.remoteOptions)
    expect(nextState.quoteVerifiedAt).toBe(999)
    expect(nextState.requiresReconfirm).toBe(false)
  })
})
