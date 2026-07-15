import { InitiaAddress } from "@initia/utils"
import type { FormValues } from "@/pages/bridge/data/form"
import {
  buildReconfirmLocationState,
  buildRouteRefreshLocationState,
} from "@/pages/bridge/data/locationState"
import type { RouterRouteResponseJson } from "@/pages/bridge/data/simulate"
import {
  buildTransferLocationState,
  getTransferBackNavigation,
  shouldSyncTransferNavigationState,
  type TransferLocationState,
} from "./transferNavigation"

describe("transfer recipient preservation across bridge refresh flow", () => {
  it("keeps recipientAddress through refresh and reconfirm updates", () => {
    const recipientAddress = "init1wlvk4e083pd3nddlfe5quy56e68atra3gu9xfs"
    const walletHexAddress = "0x1111111111111111111111111111111111111111"
    const expectedRecipientHex = InitiaAddress(recipientAddress).hex

    const route = { amount_in: "1000" } as unknown as RouterRouteResponseJson
    const bridgeValues = { srcChainId: "interwoven-1" } as unknown as FormValues
    const transferFormValues = {
      page: "fields",
      srcDenom: "uinit",
      srcChainId: "interwoven-1",
      dstDenom: "uusdc",
      dstChainId: "initiation-2",
      quantity: "1",
    }

    const initialState = {
      recipientAddress,
      localOptions: [{ chainId: "interwoven-1", denom: "uinit" }],
      remoteOptions: [{ chainId: "initiation-2", denom: "uusdc" }],
    }

    const transferState = buildTransferLocationState({
      currentState: initialState,
      route,
      quoteVerifiedAt: 10,
      hexAddress: walletHexAddress,
      values: transferFormValues,
    })

    expect(transferState.values.recipient).toBe(expectedRecipientHex)

    const refreshedState = buildRouteRefreshLocationState({
      currentState: transferState,
      route,
      values: bridgeValues,
      quoteVerifiedAt: 20,
    })
    const reconfirmedState = buildReconfirmLocationState({
      currentState: refreshedState,
      route,
      values: bridgeValues,
      quoteVerifiedAt: 20,
    })

    const nextTransferState = buildTransferLocationState({
      currentState: reconfirmedState,
      route,
      quoteVerifiedAt: 30,
      hexAddress: walletHexAddress,
      values: transferFormValues,
    })

    expect(nextTransferState.recipientAddress).toBe(recipientAddress)
    expect(nextTransferState.values.recipient).toBe(expectedRecipientHex)
    expect(nextTransferState.values.recipient).not.toBe(walletHexAddress)
  })
})

describe("shouldSyncTransferNavigationState", () => {
  const route = { amount_in: "1000" } as unknown as RouterRouteResponseJson
  const currentState: TransferLocationState = {
    route,
    quoteVerifiedAt: 10,
    values: {
      sender: "0x1111111111111111111111111111111111111111",
      recipient: "0x2222222222222222222222222222222222222222",
    },
  }

  it("syncs when quoteVerifiedAt changes for the same route and addresses", () => {
    const nextState: TransferLocationState = {
      ...currentState,
      quoteVerifiedAt: 20,
    }

    expect(shouldSyncTransferNavigationState({ currentState, nextState })).toBe(true)
  })

  it("syncs when the route reference changes", () => {
    const nextState: TransferLocationState = {
      ...currentState,
      route: { amount_in: "1000" } as unknown as RouterRouteResponseJson,
    }

    expect(shouldSyncTransferNavigationState({ currentState, nextState })).toBe(true)
  })

  it.each(["sender", "recipient"] as const)("syncs when %s changes", (field) => {
    const nextState: TransferLocationState = {
      ...currentState,
      values: {
        ...currentState.values,
        [field]: "0x3333333333333333333333333333333333333333",
      },
    }

    expect(shouldSyncTransferNavigationState({ currentState, nextState })).toBe(true)
  })

  // The false direction is the function's reason to exist: syncing writes
  // location state, which re-renders and re-derives nextState — returning
  // true for an unchanged state would loop forever.
  it("does not sync when route, quoteVerifiedAt, and addresses are unchanged", () => {
    const nextState: TransferLocationState = {
      ...currentState,
      values: { ...currentState.values },
    }

    expect(shouldSyncTransferNavigationState({ currentState, nextState })).toBe(false)
  })

  it("does not sync when values change outside the compared address fields", () => {
    const nextState = {
      ...currentState,
      values: { ...currentState.values, quantity: "2" },
    }

    expect(shouldSyncTransferNavigationState({ currentState, nextState })).toBe(false)
  })
})

describe("getTransferBackNavigation", () => {
  test("deposit + single external option + embedded: exits to the method hub (loop guard)", () => {
    expect(
      getTransferBackNavigation({
        mode: "deposit",
        hasSingleExternalAssetOption: true,
        canExit: true,
      }),
    ).toEqual({ type: "exit" })
  })

  test("deposit + single external option + standalone: goes to select-local (loop guard)", () => {
    expect(
      getTransferBackNavigation({
        mode: "deposit",
        hasSingleExternalAssetOption: true,
        canExit: false,
      }),
    ).toEqual({ type: "page", page: "select-local", clearLocal: true })
  })

  test.each([true, false])(
    "deposit + multiple external options: goes to select-external (canExit: %s)",
    (canExit) => {
      expect(
        getTransferBackNavigation({
          mode: "deposit",
          hasSingleExternalAssetOption: false,
          canExit,
        }),
      ).toEqual({ type: "page", page: "select-external", clearLocal: false })
    },
  )

  test.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])(
    "withdraw always goes to select-local (single: %s, canExit: %s)",
    (hasSingleExternalAssetOption, canExit) => {
      expect(
        getTransferBackNavigation({
          mode: "withdraw",
          hasSingleExternalAssetOption,
          canExit,
        }),
      ).toEqual({ type: "page", page: "select-local", clearLocal: true })
    },
  )
})
