// Port of the backend's internal/address/bech32.go: canonical init bech32
// handling with no dependencies. Wallet normalization needs only bech32 (EVM hex
// -> raw 20 bytes -> bech32); EIP-55 checksumming is omitted because every
// checksummed deposit address the mock serves comes from the upstream as received.

const HRP = "init"
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]

const ACCOUNT_PAYLOAD_LENGTH = 20
const CONTRACT_PAYLOAD_LENGTH = 32

function polymod(hrp: string, data: number[]): number {
  const values: number[] = []
  for (const char of hrp) values.push(char.charCodeAt(0) >> 5)
  values.push(0)
  for (const char of hrp) values.push(char.charCodeAt(0) & 31)
  values.push(...data)

  let checksum = 1
  for (const value of values) {
    const top = checksum >> 25
    checksum = ((checksum & 0x1ffffff) << 5) ^ value
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) checksum ^= GENERATORS[i]
    }
  }
  return checksum
}

/**
 * Validates a bech32 Initia address and returns its decoded payload bytes.
 * BIP-173 forbids mixed case; only 20-byte account and 32-byte contract
 * payloads with canonical padding are accepted.
 */
export function decodeInitAddress(value: string): Uint8Array | null {
  if (value !== value.toLowerCase() && value !== value.toUpperCase()) return null
  const address = value.toLowerCase()
  if (address.length < 8 || address.length > 90) return null
  const separator = address.lastIndexOf("1")
  if (separator <= 0 || separator + 7 > address.length) return null
  if (address.slice(0, separator) !== HRP) return null
  const data: number[] = []
  for (const char of address.slice(separator + 1)) {
    const index = CHARSET.indexOf(char)
    if (index < 0) return null
    data.push(index)
  }
  if (polymod(HRP, data) !== 1) return null
  return payloadBytes(data.slice(0, -6))
}

/** Encodes payload bytes as a canonical lowercase init bech32 address. */
export function encodeInitAddress(payload: Uint8Array): string {
  const data: number[] = []
  let accumulator = 0
  let bits = 0
  for (const byte of payload) {
    accumulator = (accumulator << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      data.push((accumulator >> bits) & 31)
    }
  }
  if (bits > 0) data.push((accumulator << (5 - bits)) & 31)

  const mod = polymod(HRP, [...data, 0, 0, 0, 0, 0, 0]) ^ 1
  let out = `${HRP}1`
  for (const value of data) out += CHARSET[value]
  for (let i = 0; i < 6; i++) out += CHARSET[(mod >> (5 * (5 - i))) & 31]
  return out
}

// Converts 5-bit groups to bytes, rejecting payloads that are not a 20-byte
// account or 32-byte contract address with canonical padding.
function payloadBytes(data: number[]): Uint8Array | null {
  const totalBits = data.length * 5
  const byteLength = Math.floor(totalBits / 8)
  const padBits = totalBits % 8
  if (byteLength !== ACCOUNT_PAYLOAD_LENGTH && byteLength !== CONTRACT_PAYLOAD_LENGTH) return null
  if (padBits >= 5) return null
  if (padBits > 0 && (data[data.length - 1] & ((1 << padBits) - 1)) !== 0) return null

  const payload = new Uint8Array(byteLength)
  let accumulator = 0
  let bits = 0
  let index = 0
  for (const value of data) {
    accumulator = (accumulator << 5) | value
    bits += 5
    if (bits >= 8) {
      bits -= 8
      payload[index++] = (accumulator >> bits) & 0xff
    }
  }
  return payload
}

/**
 * Canonicalizes a destination wallet to lowercase init bech32, accepting
 * either init bech32 or 0x EVM hex input (the backend's
 * NormalizeWalletAddress). Returns null for anything else.
 */
export function normalizeWalletAddress(value: string): string | null {
  const payload = decodeInitAddress(value)
  if (payload) return encodeInitAddress(payload)
  if (/^0[xX][0-9a-fA-F]{40}$/.test(value)) {
    const bytes = new Uint8Array(20)
    for (let i = 0; i < 20; i++) {
      bytes[i] = parseInt(value.slice(2 + i * 2, 4 + i * 2), 16)
    }
    return encodeInitAddress(bytes)
  }
  return null
}
