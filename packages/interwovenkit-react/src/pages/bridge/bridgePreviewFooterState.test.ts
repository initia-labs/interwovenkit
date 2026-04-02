import { getBridgePreviewFooterState } from "./bridgePreviewFooterState"

describe("getBridgePreviewFooterState", () => {
  it("keeps the preview footer active while messages are refreshing", () => {
    const approveTokens = () => {}

    expect(
      getBridgePreviewFooterState({
        approveTokens,
        exactFeeCheckError: "Insufficient balance for fees",
        isFetchingMessages: true,
        messageRefreshError: undefined,
        requiresApproval: true,
      }),
    ).toEqual({
      kind: "preview",
      isFetchingMessages: true,
      messageRefreshError: undefined,
    })
  })

  it("keeps the preview footer visible while fee or approval checks are loading", () => {
    expect(
      getBridgePreviewFooterState({
        isCheckingFeeBalance: true,
      }),
    ).toEqual({ kind: "preview", isCheckingFeeBalance: true })

    expect(
      getBridgePreviewFooterState({
        isCheckingApprovals: true,
      }),
    ).toEqual({ kind: "preview", isCheckingApprovals: true })
  })
})
