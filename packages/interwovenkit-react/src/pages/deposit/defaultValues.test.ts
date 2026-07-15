import { buildDepositDefaultValues } from "./defaultValues"

const INIT = { denom: "uinit", chainId: "interwoven-1" }
const USDC = { denom: "uusdc", chainId: "interwoven-1" }

describe("buildDepositDefaultValues", () => {
  test("no options: starts at the asset picker with nothing preset", () => {
    const values = buildDepositDefaultValues([])
    expect(values.page).toBe("select-asset")
    expect(values.receiveDenom).toBe("")
    expect(values.receiveChainId).toBe("")
    expect(values.receiveSymbol).toBe("")
  })

  test("single option: pre-selects it and skips the picker", () => {
    const values = buildDepositDefaultValues([INIT])
    expect(values.page).toBe("select-method")
    expect(values.receiveDenom).toBe(INIT.denom)
    expect(values.receiveChainId).toBe(INIT.chainId)
    // The symbol is not known synchronously; SyncReceiveSymbol fills it in.
    expect(values.receiveSymbol).toBe("")
  })

  test("multiple options: starts at the asset picker", () => {
    const values = buildDepositDefaultValues([INIT, USDC])
    expect(values.page).toBe("select-asset")
    expect(values.receiveDenom).toBe("")
    expect(values.receiveChainId).toBe("")
  })

  test("remembered payment method seeds the form", () => {
    const values = buildDepositDefaultValues([], { paymentMethodId: "banktransfer" })
    expect(values.paymentMethodId).toBe("banktransfer")
  })

  test("no remembered payment method: falls back to the default", () => {
    expect(buildDepositDefaultValues([]).paymentMethodId).toBe("creditcard")
    expect(buildDepositDefaultValues([], { paymentMethodId: null }).paymentMethodId).toBe(
      "creditcard",
    )
    // localStorage can hold an empty string; it must not seed the form.
    expect(buildDepositDefaultValues([], { paymentMethodId: "" }).paymentMethodId).toBe(
      "creditcard",
    )
  })

  test("remembered fiat seeds the form", () => {
    const values = buildDepositDefaultValues([], { fiatId: "eur" })
    expect(values.fiatId).toBe("eur")
  })

  test("no remembered fiat: falls back to the default", () => {
    expect(buildDepositDefaultValues([]).fiatId).toBe("usd")
    expect(buildDepositDefaultValues([], { fiatId: null }).fiatId).toBe("usd")
    // localStorage can hold an empty string; it must not seed the form.
    expect(buildDepositDefaultValues([], { fiatId: "" }).fiatId).toBe("usd")
  })

  // The production call shape (Deposit) always passes both keys together;
  // pins that each seeds its own field.
  test("both remembered values seed together", () => {
    const values = buildDepositDefaultValues([], { paymentMethodId: "banktransfer", fiatId: "eur" })
    expect(values.paymentMethodId).toBe("banktransfer")
    expect(values.fiatId).toBe("eur")
  })
})
