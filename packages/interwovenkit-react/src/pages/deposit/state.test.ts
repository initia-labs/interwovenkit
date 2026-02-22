import { InitiaAddress } from "@initia/utils"
import type { FormValues } from "../bridge/data/form"
import {
  buildReconfirmLocationState,
  buildRouteRefreshLocationState,
} from "../bridge/data/locationState"
import type { RouterRouteResponseJson } from "../bridge/data/simulate"
import { buildTransferLocationState } from "./state"

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

    expect((transferState.values as { recipient: string }).recipient).toBe(expectedRecipientHex)

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
    expect((nextTransferState.values as { recipient: string }).recipient).toBe(expectedRecipientHex)
    expect((nextTransferState.values as { recipient: string }).recipient).not.toBe(walletHexAddress)
  })
})
