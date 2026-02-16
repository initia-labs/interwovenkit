// @ts-expect-error psl does not currently export its declaration entry via package "exports".
import { parse } from "psl"

function isIpv4(hostname: string): boolean {
  const parts = hostname.split(".")
  if (parts.length !== 4) return false

  return parts.every((part) => {
    if (!/^\d+$/.test(part)) return false
    const value = Number(part)
    return value >= 0 && value <= 255
  })
}

function isIpHostname(hostname: string): boolean {
  return isIpv4(hostname) || hostname.includes(":")
}

function getRegistrableDomain(hostname: string): string | null {
  const parsed = parse(hostname)
  if ("error" in parsed) return null
  return parsed.domain
}

function isAllowedRegisteredHost(url: URL): boolean {
  if (url.protocol !== "https:") return false

  const hostname = url.hostname.toLowerCase()
  if (!hostname || !hostname.includes(".")) return false
  if (hostname === "localhost") return false
  if (isIpHostname(hostname)) return false

  const registrableDomain = getRegistrableDomain(hostname)
  if (!registrableDomain) return false

  return hostname === registrableDomain || hostname.endsWith(`.${registrableDomain}`)
}

export function isVerifiedWebsiteHost(registeredWebsite: string, currentHostname: string): boolean {
  try {
    const parsed = new URL(registeredWebsite)
    if (!isAllowedRegisteredHost(parsed)) return false

    const registeredHostname = parsed.hostname.toLowerCase()
    const current = currentHostname.toLowerCase()

    if (!registeredHostname || !current) return false
    if (isIpHostname(current) || current === "localhost") return false

    const currentRegistrableDomain = getRegistrableDomain(current)
    if (!currentRegistrableDomain) return false

    return current === registeredHostname || current.endsWith(`.${registeredHostname}`)
  } catch {
    return false
  }
}
