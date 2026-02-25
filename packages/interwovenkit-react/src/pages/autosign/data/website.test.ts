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

  it("returns true for sibling subdomain when registered host is www on apex domain", () => {
    expect(isVerifiedWebsiteHost("https://www.civitia.org", "app.civitia.org")).toBe(true)
  })

  it("returns false when registered host is public-suffix-like", () => {
    expect(isVerifiedWebsiteHost("https://co.uk", "evil.co.uk")).toBe(false)
    expect(isVerifiedWebsiteHost("https://com.au", "evil.com.au")).toBe(false)
    expect(isVerifiedWebsiteHost("https://org.uk", "evil.org.uk")).toBe(false)
  })

  it("returns false when registered host is a public suffix root", () => {
    expect(isVerifiedWebsiteHost("https://pages.dev", "evil.pages.dev")).toBe(false)
    expect(isVerifiedWebsiteHost("https://web.app", "evil.web.app")).toBe(false)
    expect(isVerifiedWebsiteHost("https://firebaseapp.com", "evil.firebaseapp.com")).toBe(false)
    expect(isVerifiedWebsiteHost("https://fly.dev", "evil.fly.dev")).toBe(false)
    expect(isVerifiedWebsiteHost("https://github.io", "evil.github.io")).toBe(false)
    expect(isVerifiedWebsiteHost("https://vercel.app", "evil.vercel.app")).toBe(false)
    expect(isVerifiedWebsiteHost("https://netlify.app", "evil.netlify.app")).toBe(false)
    expect(isVerifiedWebsiteHost("https://herokuapp.com", "evil.herokuapp.com")).toBe(false)
  })

  it("returns true for registrable domain under multi-part suffix", () => {
    expect(isVerifiedWebsiteHost("https://app.example.co.uk", "api.app.example.co.uk")).toBe(true)
  })

  it("returns true for registrable domain under shared-hosting suffix", () => {
    expect(isVerifiedWebsiteHost("https://my-app.pages.dev", "my-app.pages.dev")).toBe(true)
    expect(isVerifiedWebsiteHost("https://my-app.web.app", "my-app.web.app")).toBe(true)
    expect(isVerifiedWebsiteHost("https://my-app.firebaseapp.com", "my-app.firebaseapp.com")).toBe(
      true,
    )
    expect(isVerifiedWebsiteHost("https://my-app.fly.dev", "my-app.fly.dev")).toBe(true)
    expect(isVerifiedWebsiteHost("https://railway.app", "railway.app")).toBe(true)
    expect(isVerifiedWebsiteHost("https://surge.sh", "surge.sh")).toBe(true)
    expect(isVerifiedWebsiteHost("https://my-app.railway.app", "my-app.railway.app")).toBe(true)
    expect(isVerifiedWebsiteHost("https://my-app.surge.sh", "my-app.surge.sh")).toBe(true)
    expect(isVerifiedWebsiteHost("https://my-app.github.io", "my-app.github.io")).toBe(true)
    expect(isVerifiedWebsiteHost("https://my-app.vercel.app", "my-app.vercel.app")).toBe(true)
    expect(isVerifiedWebsiteHost("https://my-app.netlify.app", "my-app.netlify.app")).toBe(true)
    expect(isVerifiedWebsiteHost("https://my-app.herokuapp.com", "my-app.herokuapp.com")).toBe(true)
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
