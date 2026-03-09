import { describe, expect, it } from "vitest"
import { getFooterWithMsgsStatus } from "./FooterWithMsgs.utils"

describe("getFooterWithMsgsStatus", () => {
  it("treats the initial empty state as loading", () => {
    expect(
      getFooterWithMsgsStatus({
        error: null,
        loading: true,
        value: undefined,
      }),
    ).toEqual({
      canRenderChildren: false,
      isFetchingMessages: true,
      shouldRenderError: false,
      shouldRenderLoading: true,
    })
  })

  it("renders the error footer when no cached tx is available", () => {
    expect(
      getFooterWithMsgsStatus({
        error: new Error("fetch failed"),
        loading: false,
        value: undefined,
      }),
    ).toEqual({
      canRenderChildren: false,
      isFetchingMessages: false,
      shouldRenderError: true,
      shouldRenderLoading: true,
    })
  })

  it("keeps cached txs mounted and blocks confirmation after a refetch error", () => {
    expect(
      getFooterWithMsgsStatus({
        error: new Error("refresh failed"),
        loading: false,
        value: { tx: true },
      }),
    ).toEqual({
      canRenderChildren: true,
      isFetchingMessages: true,
      shouldRenderError: false,
      shouldRenderLoading: false,
    })
  })
})
