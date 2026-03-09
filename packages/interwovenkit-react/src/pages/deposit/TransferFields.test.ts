import type { RouterRouteResponseJson } from "../bridge/data/simulate"
import type { TransferLocationState } from "./state"
import { shouldSyncTransferNavigationState } from "./TransferFields.utils"

describe("shouldSyncTransferNavigationState", () => {
  const route = { amount_in: "100" } as unknown as RouterRouteResponseJson

  function makeState(overrides?: Partial<TransferLocationState>): TransferLocationState {
    return {
      quoteVerifiedAt: 10,
      route,
      values: {
        recipient: "0xrecipient",
        sender: "0xsender",
      },
      ...overrides,
    }
  }

  it("updates when quote verification time changes for the same route", () => {
    const currentState = makeState()
    const nextState = makeState({ quoteVerifiedAt: 20 })

    expect(shouldSyncTransferNavigationState({ currentState, nextState })).toBe(true)
  })

  it("skips navigation when route, quote time, and derived addresses are unchanged", () => {
    const currentState = makeState()
    const nextState = makeState()

    expect(shouldSyncTransferNavigationState({ currentState, nextState })).toBe(false)
  })
})
