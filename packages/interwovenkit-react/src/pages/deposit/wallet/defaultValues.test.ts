import { buildTransferDefaultValues } from "./defaultValues"

const INIT = { denom: "uinit", chainId: "interwoven-1" }
const USDC = { denom: "uusdc", chainId: "interwoven-1" }

describe("buildTransferDefaultValues", () => {
  test("no preset: starts at the select-local picker", () => {
    const values = buildTransferDefaultValues({
      mode: "deposit",
      localOptions: [INIT, USDC],
    })
    expect(values.page).toBe("select-local")
    expect(values.srcDenom).toBe("")
    expect(values.dstDenom).toBe("")
  })

  test("deposit with initialAsset: presets the destination and starts at select-external", () => {
    const values = buildTransferDefaultValues({
      mode: "deposit",
      initialAsset: INIT,
      localOptions: [],
    })
    expect(values.page).toBe("select-external")
    expect(values.dstDenom).toBe(INIT.denom)
    expect(values.dstChainId).toBe(INIT.chainId)
    expect(values.srcDenom).toBe("")
  })

  test("withdraw with initialAsset: presets the source and starts at fields", () => {
    const values = buildTransferDefaultValues({
      mode: "withdraw",
      initialAsset: INIT,
      localOptions: [],
    })
    expect(values.page).toBe("fields")
    expect(values.srcDenom).toBe(INIT.denom)
    expect(values.srcChainId).toBe(INIT.chainId)
    expect(values.dstDenom).toBe("")
  })

  test("single local option without initialAsset: presets it and skips select-local", () => {
    const deposit = buildTransferDefaultValues({ mode: "deposit", localOptions: [INIT] })
    expect(deposit.page).toBe("select-external")
    expect(deposit.dstDenom).toBe(INIT.denom)

    const withdraw = buildTransferDefaultValues({ mode: "withdraw", localOptions: [INIT] })
    expect(withdraw.page).toBe("fields")
    expect(withdraw.srcDenom).toBe(INIT.denom)
  })

  test("initialAsset wins over a single local option", () => {
    const values = buildTransferDefaultValues({
      mode: "deposit",
      initialAsset: USDC,
      localOptions: [INIT],
    })
    expect(values.dstDenom).toBe(USDC.denom)
  })
})
