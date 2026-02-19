import { QueryClient } from "@tanstack/react-query"
import { clearInterwovenKitQueries } from "./query-client"

describe("clearInterwovenKitQueries", () => {
  it("removes only InterwovenKit query cache entries", () => {
    const queryClient = new QueryClient()

    queryClient.setQueryData(["interwovenkit:chain", "mainnet"], { chainId: "interwoven-1" })
    queryClient.setQueryData(["interwovenkit:asset", "interwoven-1", "uinit"], { symbol: "INIT" })
    queryClient.setQueryData(["host-app", "todos"], [{ id: 1, title: "keep me" }])
    queryClient.setQueryData(["erc20-approvals-needed", "tx-id"], [{ spender: "0x1" }])

    clearInterwovenKitQueries(queryClient)

    expect(queryClient.getQueryData(["interwovenkit:chain", "mainnet"])).toBeUndefined()
    expect(
      queryClient.getQueryData(["interwovenkit:asset", "interwoven-1", "uinit"]),
    ).toBeUndefined()
    expect(queryClient.getQueryData(["host-app", "todos"])).toEqual([{ id: 1, title: "keep me" }])
    expect(queryClient.getQueryData(["erc20-approvals-needed", "tx-id"])).toEqual([
      { spender: "0x1" },
    ])
  })
})
