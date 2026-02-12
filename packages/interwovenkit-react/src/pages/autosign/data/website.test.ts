import { describe, expect, it } from "vitest"
import { isVerifiedWebsiteHost } from "./website"

describe("isVerifiedWebsiteHost", () => {
  it("returns true for exact host match", () => {
    expect(isVerifiedWebsiteHost("https://app.initia.xyz", "app.initia.xyz")).toBe(true)
  })

  it("returns true for subdomain of registered host", () => {
    expect(isVerifiedWebsiteHost("https://app.initia.xyz", "api.app.initia.xyz")).toBe(true)
  })

  it("returns false when current host is parent of registered host", () => {
    expect(isVerifiedWebsiteHost("https://app.initia.xyz", "initia.xyz")).toBe(false)
  })

  it("returns false for sibling subdomain", () => {
    expect(isVerifiedWebsiteHost("https://app.initia.xyz", "other.initia.xyz")).toBe(false)
  })

  it("returns false when registered host is public-suffix-like", () => {
    expect(isVerifiedWebsiteHost("https://co.uk", "evil.co.uk")).toBe(false)
    expect(isVerifiedWebsiteHost("https://com.au", "evil.com.au")).toBe(false)
    expect(isVerifiedWebsiteHost("https://org.uk", "evil.org.uk")).toBe(false)
  })

  it("returns true for registrable domain under multi-part suffix", () => {
    expect(isVerifiedWebsiteHost("https://app.example.co.uk", "api.app.example.co.uk")).toBe(true)
  })

  it("returns false for different domain", () => {
    expect(isVerifiedWebsiteHost("https://app.initia.xyz", "evil.com")).toBe(false)
  })

  it("returns false for suffix lookalike domain", () => {
    expect(isVerifiedWebsiteHost("https://initia.xyz", "evilinitia.xyz")).toBe(false)
  })

  it("is case-insensitive", () => {
    expect(isVerifiedWebsiteHost("https://App.Initia.XYZ", "API.APP.INITIA.XYZ")).toBe(true)
  })

  it("returns false when current hostname is empty", () => {
    expect(isVerifiedWebsiteHost("https://app.initia.xyz", "")).toBe(false)
  })

  it("returns false for malformed registered website URL", () => {
    expect(isVerifiedWebsiteHost("not-a-url", "app.initia.xyz")).toBe(false)
  })

  it("returns false for non-https registered website URL", () => {
    expect(isVerifiedWebsiteHost("http://app.initia.xyz", "app.initia.xyz")).toBe(false)
  })

  it("returns false for localhost registered website URL", () => {
    expect(isVerifiedWebsiteHost("https://localhost", "localhost")).toBe(false)
  })

  it("returns false for ip registered website URL", () => {
    expect(isVerifiedWebsiteHost("https://127.0.0.1", "127.0.0.1")).toBe(false)
  })
})
