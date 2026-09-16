/** Shared identities for the mocked Deposit API suite. */

/** Unresolvable on purpose (see playwright.mock.config.ts). */
export const DEPOSIT_API_ORIGIN = "https://deposit-api.mock.invalid"

/** Address 0 of the public junk mnemonic the mock web server runs with. */
export const SENDER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
/** `InitiaAddress(SENDER).bech32`, the recipient every request is bound to. */
export const RECIPIENT = "init17w0adeg64ky0daxwd2ugyuneellmjgnxdtmpqz"

export const ETHEREUM_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
export const ARBITRUM_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"

export const IUSD = {
  chainId: "interwoven-1",
  denom: "move/6c69733a9e722f3660afb524f89fce957801fa7e4408b8ef8fe89db9627b570e",
  decimals: 6,
  symbol: "iUSD",
}

/** USDC base units for a token quantity typed into the form. */
export const usdc = (quantity: string) =>
  (BigInt(Math.round(Number(quantity) * 1e6)) as bigint).toString()
