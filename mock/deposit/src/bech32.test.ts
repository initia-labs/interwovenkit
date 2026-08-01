import { describe, expect, it } from "vitest"
import { decodeInitAddress, encodeInitAddress, normalizeWalletAddress } from "./bech32.ts"

// Real address from the deposit docs' measured checkout payload.
const KNOWN_ADDRESS = "init1veaum7vy45fzw5x4mflskgx5lnmwmxx5wm3x8p"

describe("normalizeWalletAddress", () => {
  it("accepts a canonical lowercase bech32 address", () => {
    expect(normalizeWalletAddress(KNOWN_ADDRESS)).toBe(KNOWN_ADDRESS)
  })

  it("accepts an all-uppercase bech32 address (BIP-173 allows single-case)", () => {
    expect(normalizeWalletAddress(KNOWN_ADDRESS.toUpperCase())).toBe(KNOWN_ADDRESS)
  })

  it("rejects mixed-case bech32", () => {
    expect(normalizeWalletAddress(`Init1${KNOWN_ADDRESS.slice(5)}`)).toBeNull()
  })

  it("normalizes the 0x EVM form to the same bech32 address", () => {
    const payload = decodeInitAddress(KNOWN_ADDRESS)!
    const hex = `0x${[...payload].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`
    expect(normalizeWalletAddress(hex)).toBe(KNOWN_ADDRESS)
    expect(normalizeWalletAddress(hex.toUpperCase().replace("0X", "0x"))).toBe(KNOWN_ADDRESS)
  })

  it("rejects a corrupted checksum", () => {
    const corrupted = KNOWN_ADDRESS.slice(0, -1) + (KNOWN_ADDRESS.endsWith("p") ? "q" : "p")
    expect(normalizeWalletAddress(corrupted)).toBeNull()
  })

  it("rejects other HRPs, junk, and short hex", () => {
    expect(normalizeWalletAddress("cosmos1veaum7vy45fzw5x4mflskgx5lnmwmxx5wm3x8p")).toBeNull()
    expect(normalizeWalletAddress("not-an-address")).toBeNull()
    expect(normalizeWalletAddress("0x1234")).toBeNull()
    expect(normalizeWalletAddress("")).toBeNull()
  })
})

describe("encodeInitAddress / decodeInitAddress", () => {
  it("round-trips 20-byte payloads", () => {
    const payload = new Uint8Array(20).map((_, index) => index * 7)
    expect(decodeInitAddress(encodeInitAddress(payload))).toEqual(payload)
  })

  it("round-trips 32-byte contract payloads", () => {
    const payload = new Uint8Array(32).map((_, index) => 255 - index)
    expect(decodeInitAddress(encodeInitAddress(payload))).toEqual(payload)
  })
})
