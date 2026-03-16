import type { SignedOpHook } from "./tx"

export function getBridgeMsgsRequestKey({
  addressList,
  operations,
  signedOpHook,
  quoteVerifiedAt,
}: {
  addressList: string[]
  operations: unknown
  signedOpHook?: SignedOpHook
  quoteVerifiedAt?: number
}): string {
  return JSON.stringify({
    addressList,
    operations,
    signedOpHook: signedOpHook ?? null,
    quoteVerifiedAt,
  })
}
