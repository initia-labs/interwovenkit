import type { RouterRouteResponseJson } from "../bridge/data/simulate"
import type { TransferLocationState } from "./state"
import { shouldSyncTransferNavigationState } from "./transferNavigationState"

describe("shouldSyncTransferNavigationState", () => {
  it("syncs when quoteVerifiedAt changes for the same route and addresses", () => {
    const route = { amount_in: "1000" } as unknown as RouterRouteResponseJson
    const currentState: TransferLocationState = {
      route,
      quoteVerifiedAt: 10,
      values: {
        sender: "0x1111111111111111111111111111111111111111",
        recipient: "0x2222222222222222222222222222222222222222",
      },
    }
    const nextState: TransferLocationState = {
      ...currentState,
      quoteVerifiedAt: 20,
    }

    expect(
      shouldSyncTransferNavigationState({
        currentState,
        nextState,
      }),
    ).toBe(true)
  })
})
