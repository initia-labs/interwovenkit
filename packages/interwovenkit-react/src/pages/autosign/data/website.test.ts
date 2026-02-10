import { describe, expect, it } from "vitest"
import { isVerifiedWebsiteHost } from "./website"

describe("isVerifiedWebsiteHost", () => {
  it("returns true for exact host match", () => {
    expect(isVerifiedWebsiteHost("https://app.initia.xyz", "app.initia.xyz")).toBe(true)
  })

  it("returns true for subdomain of registered host", () => {
    expect(isVerifiedWebsiteHost("https://app.initia.xyz", "api.app.initia.xyz")).toBe(true)
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
})
