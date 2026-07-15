import ky from "ky"
import { useMemo } from "react"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { useConfig } from "@/data/config"

export const depositQueryKeys = createQueryKeys("interwovenkit:deposit", {
  assets: null,
  depositAddress: (walletAddress: string, chainId: string, assetDenom: string) => [
    walletAddress,
    chainId,
    assetDenom,
  ],
  deposit: (id: string) => [id],
  deposits: (depositAddress: string) => [depositAddress],
  // New-arrival detection poll for the advance screens (`after=<cursor>`), keyed
  // by the mount-fresh cursor so a re-entered screen never reads a previous
  // mount's cached result.
  newDeposits: (depositAddress: string, after: string) => [depositAddress, after],
  // Non-terminal deposits at the address (`active=true`), for the
  // deposit-address screen's "transfer detected" resume link.
  activeDeposits: (depositAddress: string) => [depositAddress],
  // Onramper (cash/card path)
  onramperSupported: null,
  onramperOnramps: null,
  onramperGeoDefaults: null,
  onramperPaymentTypes: (source: string, destination: string) => [source, destination],
  onramperQuotes: (fiat: string, crypto: string, amount: string, paymentMethod: string) => [
    fiat,
    crypto,
    amount,
    paymentMethod,
  ],
  // Deposit API pre-quote (GET /v1/quote) for the Buy form's "Minimum
  // received" (amountIn in source base units).
  minReceived: (
    srcChainId: string,
    srcDenom: string,
    dstChainId: string,
    dstDenom: string,
    amountIn: string,
  ) => [srcChainId, srcDenom, dstChainId, dstDenom, amountIn],
})

/**
 * ky instance for the Deposit API (crypto onramp path). Base URL from config
 * (`depositApiUrl`); consumers gate calls on it being set.
 *
 * No custom headers: the CORS allowlist permits only Authorization,
 * Content-Type, X-Correlation-ID, and X-Request-ID, so an InterwovenKit-Version
 * header (as useSkip sends) would trip the preflight and block every request.
 */
export function useDepositApi() {
  const { depositApiUrl } = useConfig()
  return useMemo(() => ky.create({ prefixUrl: depositApiUrl }), [depositApiUrl])
}

/**
 * ky instance for the Onramper aggregator API (cash/card onramp path). The base
 * URL and key come from config; Onramper authenticates with the publishable key
 * in a raw `Authorization` header (no `Bearer` prefix). Consumers gate calls on
 * useOnramperEnabled.
 */
export function useOnramper() {
  const { onramperApiUrl, onramperApiKey } = useConfig()
  return useMemo(
    () =>
      ky.create({
        prefixUrl: onramperApiUrl,
        headers: onramperApiKey ? { Authorization: onramperApiKey } : undefined,
      }),
    [onramperApiUrl, onramperApiKey],
  )
}

/**
 * Whether the cash path is configured: both the Onramper base URL and the
 * publishable key must be set. The single gate keeps the method toggle and the
 * query `enabled` flags consistent — a missing key surfaces as an unavailable
 * method instead of obscurely failing requests (Onramper answers a bad key with
 * 200 and empty lists, not a 401 — see assertOnramperSupported).
 */
export function useOnramperEnabled(): boolean {
  const { onramperApiUrl, onramperApiKey } = useConfig()
  return !!onramperApiUrl && !!onramperApiKey
}
